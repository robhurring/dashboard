//! Wire protocol between the server and every client. See spec section 7.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use ts_rs::TS;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub enum Kind {
    View,
    State,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol/")]
pub struct Status {
    pub ok: bool,
    #[ts(type = "number | null")]
    pub fetched_at: Option<i64>,
    #[ts(type = "number | null")]
    pub pushed_at: Option<i64>,
    pub writer: Option<String>,
    pub error: Option<String>,
    #[ts(type = "number | null")]
    pub retry_at: Option<i64>,
    pub loading: bool,
    pub load_error: Option<String>,
}

impl Status {
    pub fn ok_at(fetched_at: i64) -> Self {
        Self { ok: true, fetched_at: Some(fetched_at), ..Default::default() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol/")]
pub struct InstanceInfo {
    pub id: String,
    pub module: String,
    pub kind: Kind,
    pub component: Option<String>,
    /// The module's default title template, e.g. "Weather: {{config.zip}}".
    pub title: Option<String>,
    /// The module's default header icon (a Lucide name, or "redis").
    pub icon: Option<String>,
    /// No fetch, only hooks: state exists only after the first push.
    pub push_only: bool,
}

/// One mounted `<Slot>`: the instance a screen wants, with every prop it was given.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol/")]
pub struct SlotDecl {
    pub id: String,
    pub module: String,
    #[serde(default)]
    pub props: Value,
    /// Whether the slot's page is on screen. Hidden slots stay declared (their snapshots and hook
    /// pushes still arrive) but do not make the module poll.
    #[serde(default = "visible_default")]
    #[ts(optional, as = "Option<bool>")]
    pub visible: bool,
}

fn visible_default() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub enum ClientMsg {
    Hello {
        protocol: u32,
        screen: String,
        #[serde(default)]
        #[ts(type = "Record<string, number>")]
        have: HashMap<String, u64>,
    },
    Watch {
        slots: Vec<SlotDecl>,
    },
    Command {
        id: String,
        instance: String,
        action: String,
        #[serde(default)]
        args: Value,
    },
    Refresh {
        instance: String,
    },
    Pong,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub enum ServerMsg {
    Welcome {
        server: String,
        protocol: u32,
        instances: Vec<InstanceInfo>,
    },
    Snapshot {
        instance: String,
        #[ts(type = "number")]
        rev: u64,
        kind: Kind,
        view: Option<Value>,
        state: Option<Value>,
        config: Value,
        component: Option<String>,
        status: Status,
    },
    Status {
        instance: String,
        status: Status,
    },
    Remove {
        instance: String,
    },
    Ack {
        id: String,
    },
    Fail {
        id: String,
        error: String,
    },
    Ping,
}
