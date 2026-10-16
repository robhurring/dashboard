//! One task per connected client. See spec section 7.
use crate::{
    hub::{Hub, HubEvent, Stored},
    protocol::{ClientMsg, PROTOCOL_VERSION, ServerMsg},
    supervisor::SupervisorHandle,
};
use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use futures::{SinkExt, StreamExt, stream::SplitStream};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{broadcast, mpsc},
    time::Instant,
};

const PING_EVERY: Duration = Duration::from_secs(15);
const PONG_TIMEOUT: Duration = Duration::from_secs(30);
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct AppState {
    pub hub: Arc<Hub>,
    pub supervisor: SupervisorHandle,
    pub sessions: Arc<AtomicU64>,
}

pub async fn upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| session(socket, state))
}

async fn session(socket: WebSocket, state: AppState) {
    let id = state.sessions.fetch_add(1, Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();
    let (out, mut out_rx) = mpsc::unbounded_channel::<ServerMsg>();
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            let Ok(text) = serde_json::to_string(&msg) else { continue };
            tracing::debug!(session = id, "→ {}", describe_server_msg(&msg));
            tracing::trace!(session = id, "→ {text}");
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    // Subscribe before reading state so nothing published in between is missed.
    let mut events = state.hub.subscribe();
    let have = match tokio::time::timeout(HELLO_TIMEOUT, read_msg(&mut stream)).await {
        Ok(Some(ClientMsg::Hello { protocol, screen, have })) if protocol == PROTOCOL_VERSION => {
            tracing::info!(session = id, %screen, "client connected");
            have
        }
        Ok(Some(ClientMsg::Hello { protocol, .. })) => {
            let _ = out.send(ServerMsg::Fail {
                id: "hello".into(),
                error: format!("protocol {protocol} is not supported; this server speaks protocol {PROTOCOL_VERSION}"),
            });
            drop(out);
            let _ = writer.await;
            return;
        }
        _ => {
            drop(out);
            let _ = writer.await;
            return;
        }
    };
    // Revs this session has delivered. Events queued before `hello` would otherwise be sent twice.
    let mut sent: HashMap<String, u64> = have;
    send_welcome(&state.hub, &out, &mut sent).await;

    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    let mut last_pong = Instant::now();
    loop {
        tokio::select! {
            msg = read_msg(&mut stream) => match msg {
                None => break,
                Some(ClientMsg::Pong) => last_pong = Instant::now(),
                Some(ClientMsg::Watch { slots }) => {
                    tracing::debug!(session = id, count = slots.len(), "watch");
                    let _ = state.supervisor.watch(id, slots).await;
                    // Problems with this screen's own declarations go only to this screen.
                    for (instance, msg) in state.supervisor.session_errors(id).await {
                        let mut status = state.hub.get(&instance).await.map(|s| s.status).unwrap_or_default();
                        status.load_error = Some(msg);
                        let _ = out.send(ServerMsg::Status { instance, status });
                    }
                }
                Some(ClientMsg::Refresh { instance }) => state.supervisor.client_refresh(instance),
                Some(ClientMsg::Command { id: cmd_id, instance, action, args }) => {
                    tracing::info!(session = id, %instance, %action, "command received");
                    let sup = state.supervisor.clone();
                    let out = out.clone();
                    tokio::spawn(async move {
                        let reply = match sup.instance(&instance).await {
                            None => Err(format!("unknown instance {instance:?}")),
                            Some(h) => h.command(action, args).await,
                        };
                        let _ = out.send(match reply {
                            Ok(()) => ServerMsg::Ack { id: cmd_id },
                            Err(error) => ServerMsg::Fail { id: cmd_id, error },
                        });
                    });
                }
                Some(ClientMsg::Hello { .. }) => {}
            },
            ev = events.recv() => match ev {
                Ok(HubEvent::Snapshot(i)) => {
                    if let Some(s) = state.hub.get(&i).await {
                        send_if_newer(&out, &mut sent, &i, s);
                    }
                }
                Ok(HubEvent::Status(i)) => {
                    if let Some(s) = state.hub.get(&i).await {
                        let _ = out.send(ServerMsg::Status { instance: i, status: s.status });
                    }
                }
                Ok(HubEvent::Removed(i)) => {
                    sent.remove(&i);
                    let _ = out.send(ServerMsg::Remove { instance: i });
                }
                // Catalog changes and lag both resend everything; the client ignores revs it already has.
                Ok(HubEvent::Catalog) | Err(broadcast::error::RecvError::Lagged(_)) => {
                    send_welcome(&state.hub, &out, &mut sent).await
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            _ = ping.tick() => {
                if last_pong.elapsed() > PONG_TIMEOUT {
                    tracing::info!(session = id, "client stopped answering pings");
                    break;
                }
                let _ = out.send(ServerMsg::Ping);
            }
        }
    }
    tracing::info!(session = id, "client disconnected");
    state.supervisor.unwatch(id);
    drop(out);
    let _ = writer.await;
}

async fn read_msg(stream: &mut SplitStream<WebSocket>) -> Option<ClientMsg> {
    loop {
        match stream.next().await? {
            Ok(Message::Text(t)) => match serde_json::from_str::<ClientMsg>(t.as_str()) {
                Ok(m) => {
                    tracing::debug!("← {}", describe_client_msg(&m));
                    tracing::trace!("← {}", t.as_str());
                    return Some(m);
                }
                Err(e) => tracing::warn!(error = %e, "ignoring malformed client message"),
            },
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

async fn send_welcome(hub: &Hub, out: &mpsc::UnboundedSender<ServerMsg>, sent: &mut HashMap<String, u64>) {
    let instances = hub.catalog().await;
    let _ = out.send(ServerMsg::Welcome {
        // Version plus the deployed revision (Dokku sets GIT_REV): clients reload when this changes between connections.
        server: match std::env::var("GIT_REV") {
            Ok(rev) if !rev.is_empty() => format!("{}+{}", env!("CARGO_PKG_VERSION"), &rev[..rev.len().min(12)]),
            _ => env!("CARGO_PKG_VERSION").into(),
        },
        protocol: PROTOCOL_VERSION,
        instances: instances.clone(),
    });
    for info in instances {
        let Some(s) = hub.get(&info.id).await else { continue };
        if s.rev == 0 {
            // Never fetched: still tell the client about load errors.
            let _ = out.send(ServerMsg::Status { instance: info.id.clone(), status: s.status });
        } else {
            send_if_newer(out, sent, &info.id, s);
        }
    }
}

/// Sends a snapshot only if this session has not already delivered that rev.
fn send_if_newer(out: &mpsc::UnboundedSender<ServerMsg>, sent: &mut HashMap<String, u64>, id: &str, s: Stored) {
    if s.rev > sent.get(id).copied().unwrap_or(0) {
        sent.insert(id.to_string(), s.rev);
        let _ = out.send(to_snapshot(id, s));
    }
}

/// One line per message for debug logs: type plus the fields that identify it, never full payloads.
fn describe_server_msg(m: &ServerMsg) -> String {
    match m {
        ServerMsg::Welcome { instances, .. } => format!("welcome ({} instances)", instances.len()),
        ServerMsg::Snapshot { instance, rev, kind, .. } => format!("snapshot {instance} rev={rev} kind={kind:?}"),
        ServerMsg::Status { instance, status } => {
            format!("status {instance} ok={} loading={} error={:?} load_error={:?}", status.ok, status.loading, status.error, status.load_error)
        }
        ServerMsg::Remove { instance } => format!("remove {instance}"),
        ServerMsg::Ack { id } => format!("ack {id}"),
        ServerMsg::Fail { id, error } => format!("fail {id}: {error}"),
        ServerMsg::Ping => "ping".into(),
    }
}

fn describe_client_msg(m: &ClientMsg) -> String {
    match m {
        ClientMsg::Hello { protocol, screen, have } => format!("hello protocol={protocol} screen={screen} have={} revs", have.len()),
        ClientMsg::Watch { slots } => format!("watch {:?}", slots.iter().map(|s| s.id.as_str()).collect::<Vec<_>>()),
        ClientMsg::Command { id, instance, action, .. } => format!("command {id} {instance}.{action}"),
        ClientMsg::Refresh { instance } => format!("refresh {instance}"),
        ClientMsg::Pong => "pong".into(),
    }
}

fn to_snapshot(id: &str, s: Stored) -> ServerMsg {
    ServerMsg::Snapshot {
        instance: id.to_string(),
        rev: s.rev,
        kind: s.kind,
        state: Some(s.state),
        config: s.config,
        view: s.view,
        component: s.component,
        status: s.status,
    }
}
