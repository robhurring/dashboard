import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, type DropAnimation,
} from "@dnd-kit/core";
import { AlarmClock, CalendarDays, Check, ChevronUp, ChevronsUp, Repeat, Undo2 } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { CustomProps } from "@dashboard/components/registry";
import { useFlip } from "./flip";
import "./board.css";

/*
 * Todoist tasks as post-it notes. `TodoistBoard` is one column per section with drag between
 * columns; `TodoistList` is the same cards in one flowing list. Both read the module's state and
 * talk back through `send("move" | "complete" | "reopen")`.
 */

export type Task = {
  id: string; content: string; description: string; due: string | null; priority: number; project_name: string | null;
  labels: string[]; days_overdue: number | null; overdue: boolean; section_id: string | null; added_at: string | null;
  updated_at: string | null; is_recurring: boolean;
};
export type Column = { key: string; label: string; section_id?: string | null; items: Task[] };
export type BoardState = { columns: Column[]; total: number; project_id: string; synced_at: number };

/** With a mouse, moving this far starts a drag and a still click is a tap. On touch, a note lifts after a hold so short swipes still scroll. */
const DRAG_DISTANCE_PX = 6;
const HOLD_TO_DRAG_MS = 250;
const HOLD_TOLERANCE_PX = 5;
const BACKLOG_KEY = "backlog";
const UNDO_WINDOW_MS = 6000;
/** A completed note shrinks and fades for this long before it leaves the column. */
const LEAVE_MS = 260;
/** An optimistic move is kept until a snapshot confirms it, or this long if the refetch never comes. */
const PENDING_MOVE_MAX_MS = 30_000;
/** A dropped note glides to its slot and settles its lift for this long. */
const DROP_MS = 320;
const DROP_EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** The timings above, handed to board.css so the CSS animations and the JS timers can't drift apart. */
const MOTION_VARS = { "--note-leave-ms": `${LEAVE_MS}ms`, "--note-drop-ms": `${DROP_MS}ms`, "--note-drop-easing": DROP_EASING } as CSSProperties;

// ─── Helpers ────────────────────────────────────────────────────────────────

type Paper = "coral" | "tangerine" | "sky" | "canary";
export function paperFor(priority: number): Paper {
  switch (priority) {
    case 4: return "coral";
    case 3: return "tangerine";
    case 2: return "sky";
    default: return "canary";
  }
}

function priorityLabel(priority: number): string {
  switch (priority) {
    case 4: return "P1 urgent";
    case 3: return "P2 important";
    case 2: return "P3";
    default: return "no priority";
  }
}

/** "3h ago", "2d ago", "just now". */
function agoText(iso: string | null): string | null {
  if (!iso) return null;
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const units: [number, string][] = [[604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]];
  for (const [size, suffix] of units) if (secs >= size) return `${Math.floor(secs / size)}${suffix} ago`;
  return "just now";
}

/** Due text relative to today, by calendar day. */
export function formatDue(due: string | null, daysOverdue: number | null): { text: string; late: boolean } | null {
  if (!due) return null;
  if (daysOverdue && daysOverdue > 0) return { text: `${daysOverdue}d`, late: true };
  const [y, m, d] = due.slice(0, 10).split("-").map(Number);
  const dueLocal = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((dueLocal.getTime() - today.getTime()) / 86_400_000);
  if (days <= 0) return { text: "today", late: false };
  if (days === 1) return { text: "tmrw", late: false };
  if (days < 7) return { text: `${days}d`, late: false };
  return { text: `${Math.floor(days / 7)}w`, late: false };
}

function longDate(due: string | null): string | null {
  if (!due) return null;
  const [y, m, d] = due.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** A move the user made that Todoist has not confirmed yet, applied on top of server data. */
export type PendingMove = { item: Task; toKey: string };

/** The server's column order: overdue first, then priority (4 = P1), then id. A moved card lands where the snapshot will put it. */
function byBoardOrder(a: Task, b: Task): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function applyPendingMoves(columns: Column[], pending: Record<string, PendingMove>): Column[] {
  const moves = Object.values(pending);
  if (moves.length === 0) return columns;
  const movedIds = new Set(Object.keys(pending));
  return columns.map((col) => {
    const kept = col.items.filter((item) => !movedIds.has(item.id));
    const incoming = moves.filter((m) => m.toKey === col.key).map((m) => m.item);
    return incoming.length === 0 ? { ...col, items: kept } : { ...col, items: [...incoming, ...kept].sort(byBoardOrder) };
  });
}

// ─── Markdown: Todoist allows it in titles and descriptions. Links stay text: a kiosk must never navigate away.

const INLINE_ELEMENTS = ["strong", "em", "code", "a", "del"];
const BLOCK_ELEMENTS = [...INLINE_ELEMENTS, "p", "ul", "ol", "li", "br"];
const markdownComponents: Components = { a: ({ children }) => <span className="note-link">{children}</span> };

function Inline({ text }: { text: string }) {
  return <ReactMarkdown allowedElements={INLINE_ELEMENTS} unwrapDisallowed skipHtml components={markdownComponents}>{text}</ReactMarkdown>;
}
function Blocks({ text }: { text: string }) {
  return <ReactMarkdown allowedElements={BLOCK_ELEMENTS} unwrapDisallowed skipHtml components={markdownComponents}>{text}</ReactMarkdown>;
}

// ─── Notes ──────────────────────────────────────────────────────────────────

type NoteProps = { item: Task; columnKey: string; open?: boolean; onDone?: () => void; className?: string };

/**
 * A post-it: title band, description, a details block (collapsed until the note is open), footer.
 * Opening only grows the details block; nothing else on the note changes.
 */
function Note({ item, columnKey, open = false, onDone, className = "" }: NoteProps) {
  const due = formatDue(item.due, item.days_overdue);
  const updated = agoText(item.updated_at ?? item.added_at);
  const classes = ["note", due?.late ? "note--late" : "", open ? "note--open" : "", className].filter(Boolean).join(" ");
  return (
    <div className={classes} data-paper={paperFor(item.priority)}>
      <div className="note-head">
        {item.priority === 4 && <ChevronsUp className="note-flag" size={16} strokeWidth={2.75} aria-label="urgent" />}
        {item.priority === 3 && <ChevronUp className="note-flag" size={16} strokeWidth={2.75} aria-label="important" />}
        <span className="note-title"><Inline text={item.content} /></span>
        {due && (
          <span className={`note-due ${due.late ? "note-due--late" : ""}`}>
            {due.late ? <AlarmClock size={13} strokeWidth={2.5} /> : <CalendarDays size={13} strokeWidth={2.25} />}
            {due.text}
          </span>
        )}
      </div>
      {item.description && <div className="note-desc"><Blocks text={item.description} /></div>}
      <div className="note-details" data-open={open} aria-hidden={!open} inert={!open}>
        <div className="note-details-inner">
          <div role="group" aria-label={`${item.content} details`} className="note-stats">
            <dl className="note-meta">
              <div><dt>Due</dt><dd className={due?.late ? "note-meta--late" : ""}>{item.due ? `${longDate(item.due)}${due?.late ? `, ${due.text} late` : ""}` : "none"}{item.is_recurring && <span className="note-meta-repeat"><Repeat size={11} /> repeats</span>}</dd></div>
              <div><dt>Priority</dt><dd>{priorityLabel(item.priority)}</dd></div>
              {item.project_name && <div><dt>Project</dt><dd>{item.project_name}</dd></div>}
              {item.labels.length > 0 && <div><dt>Labels</dt><dd>{item.labels.map((l) => `@${l}`).join("  ")}</dd></div>}
              <div><dt>Added</dt><dd>{agoText(item.added_at) ?? "unknown"}</dd></div>
              <div><dt>Updated</dt><dd>{agoText(item.updated_at) ?? "unknown"}</dd></div>
            </dl>
            <button type="button" className="note-done" onClick={onDone} aria-label="Done" tabIndex={open ? 0 : -1}><Check size={16} strokeWidth={3} /> Done</button>
          </div>
        </div>
      </div>
      <div className="note-foot">
        {updated && <span className="note-age">updated {updated}</span>}
        <span className="note-tags">
          {item.is_recurring && <span className="note-tag note-tag--icon"><Repeat size={11} /></span>}
          {columnKey === BACKLOG_KEY && item.project_name && <span className="note-tag">{item.project_name}</span>}
          {item.labels.map((label) => <span key={label} className="note-tag">@{label}</span>)}
        </span>
      </div>
    </div>
  );
}

type SlotProps = { item: Task; columnKey: string; open: boolean; draggable: boolean; leaving: boolean; onTap: () => void; onDone: () => void };

/**
 * A note in a column. A tap opens or closes it; with a mouse, moving drags it, and on touch a hold
 * lifts it. An open note is not draggable so its button behaves like a button.
 */
function NoteSlot({ item, columnKey, open, draggable, leaving, onTap, onDone }: SlotProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { item, fromKey: columnKey }, disabled: open || !draggable });
  const press = useRef<{ x: number; y: number; at: number } | null>(null);
  return (
    <li
      ref={setNodeRef}
      className={`note-slot ${leaving ? "note-slot--leaving" : ""}`}
      data-flip-id={item.id}
      data-flip-skip={isDragging || leaving}
      data-swipe={draggable && !open ? "touch" : undefined}
      {...(open || !draggable ? {} : { ...listeners, ...attributes })}
      onPointerDown={(e) => { press.current = { x: e.clientX, y: e.clientY, at: performance.now() }; }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (!p || (e.target as Element).closest("button")) return;
        const still = Math.hypot(e.clientX - p.x, e.clientY - p.y) <= HOLD_TOLERANCE_PX;
        // A touch held past the drag delay has lifted the note, so only a short touch is a tap.
        const quick = e.pointerType !== "touch" || performance.now() - p.at < HOLD_TO_DRAG_MS;
        if (still && quick) onTap();
      }}
      onPointerCancel={() => { press.current = null; }}
    >
      <Note item={item} columnKey={columnKey} open={open} onDone={onDone} className={isDragging ? "note--dragging" : ""} />
    </li>
  );
}

// ─── Shared behaviour: optimistic moves, completes with undo ─────────────────

/** What the toast says: a completion with undo, or why something failed. */
export type Notice =
  | { kind: "completed"; item: Task }
  | { kind: "complete-failed"; item: Task }
  | { kind: "move-failed"; item: Task; toLabel: string; error: string };

/**
 * Shared behaviour for both layouts. Moves and completes apply to the screen at once; the server's
 * answer either confirms them (the next snapshot) or reverts them with a notice.
 */
export function useTasks(state: BoardState | null, send: CustomProps["send"]) {
  const [pending, setPending] = useState<Record<string, PendingMove>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const undone = useRef<Set<string>>(new Set());

  const columns = useMemo(() => {
    const moved = applyPendingMoves(state?.columns ?? [], pending);
    return hidden.size === 0 ? moved : moved.map((col) => ({ ...col, items: col.items.filter((i) => !hidden.has(i.id)) }));
  }, [state, pending, hidden]);

  // A pending move retires once a snapshot shows the card in its new column.
  useEffect(() => {
    const confirmed = Object.values(pending).filter((m) => state?.columns.some((col) => col.key === m.toKey && col.items.some((i) => i.id === m.item.id)));
    if (confirmed.length === 0) return;
    setPending((prev) => { const next = { ...prev }; for (const m of confirmed) delete next[m.item.id]; return next; });
  }, [state, pending]);

  const dropPending = useCallback((id: string) => setPending((prev) => { if (!(id in prev)) return prev; const next = { ...prev }; delete next[id]; return next; }), []);

  const unhide = useCallback((id: string) => setHidden((prev) => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; }), []);

  /** Lands the note in its new column now. The snapshot after the server's refetch confirms it; a rejection moves it back. */
  const move = useCallback((item: Task, toKey: string, sectionId: string | null | undefined) => {
    setPending((prev) => ({ ...prev, [item.id]: { item, toKey } }));
    const expiry = setTimeout(() => dropPending(item.id), PENDING_MOVE_MAX_MS);
    send("move", sectionId ? { id: item.id, section_id: sectionId } : { id: item.id })
      .then(() => undefined)
      .catch((e: Error) => {
        clearTimeout(expiry);
        dropPending(item.id);
        const toLabel = state?.columns.find((c) => c.key === toKey)?.label ?? toKey;
        // Host errors can carry the upstream URL; the toast wants the short reason ("http 400").
        const error = (e?.message ?? String(e)).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
        setNotice({ kind: "move-failed", item, toLabel, error });
      });
  }, [send, state, dropPending]);

  const complete = useCallback((item: Task) => {
    setOpenId(null);
    setLeaving((prev) => new Set(prev).add(item.id));
    setNotice({ kind: "completed", item });
    let rejected = false;
    const stopLeaving = () => setLeaving((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    setTimeout(() => {
      stopLeaving();
      if (!rejected) setHidden((prev) => new Set(prev).add(item.id));
    }, LEAVE_MS);
    send("complete", { id: item.id })
      .catch(() => {
        if (undone.current.has(item.id)) return;
        rejected = true;
        stopLeaving();
        unhide(item.id);
        setNotice({ kind: "complete-failed", item });
      });
  }, [send, unhide]);

  const undo = useCallback(() => {
    if (notice?.kind !== "completed") return;
    const { item } = notice;
    undone.current.add(item.id);
    setNotice(null);
    unhide(item.id);
    send("reopen", { id: item.id }).catch(() => undefined).finally(() => undone.current.delete(item.id));
  }, [notice, send, unhide]);

  return { columns, openId, setOpenId, notice, setNotice, leaving, move, complete, undo };
}

function NoticeToast({ notice, onUndo, onDismiss }: { notice: Notice; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => { const t = setTimeout(onDismiss, UNDO_WINDOW_MS); return () => clearTimeout(t); }, [notice, onDismiss]);
  const { item } = notice;
  if (notice.kind === "complete-failed") {
    return <div className="toast toast--error" role="status" aria-label="Complete failed"><span>Could not complete "<Inline text={item.content} />". It is still on the board.</span></div>;
  }
  if (notice.kind === "move-failed") {
    return <div className="toast toast--error" role="status" aria-label="Move failed"><span>Could not move "<Inline text={item.content} />" to {notice.toLabel}: {notice.error}. It is back where it was.</span></div>;
  }
  return (
    <div className="toast" role="status" aria-label="Task completed">
      <Check size={16} strokeWidth={3} />
      <span>Completed "<Inline text={item.content} />"{item.is_recurring && <em className="toast-note"><Repeat size={12} /> repeats, back with its next date</em>}</span>
      <button type="button" className="toast-undo" onClick={onUndo}><Undo2 size={14} /> Undo</button>
    </div>
  );
}

// ─── Board ──────────────────────────────────────────────────────────────────

/*
 * Drop: the overlay wrapper only glides to the landing slot; the note inside settles its own lift
 * (scale, rotation, shadow) over the same time. Both end exactly at the resting pose, so the real
 * note underneath, hidden until the copy unmounts, takes over without a visible jump.
 *
 * The landing slot is looked up in the DOM by task id: after a cross-column move the card has
 * re-rendered in its new column, and dnd-kit's `active.node` can still point at the old slot
 * (reliably so under StrictMode), which would fly the copy back to where it started.
 */
let lastDrop: { id: string; toKey: string } | null = null;

function landingSlot(active: { id: string | number; node: HTMLElement }): HTMLElement {
  const id = CSS.escape(String(active.id));
  const column = lastDrop && lastDrop.id === String(active.id) ? `[data-column-key="${CSS.escape(lastDrop.toKey)}"] ` : "";
  return document.querySelector<HTMLElement>(`${column}.note-slot[data-flip-id="${id}"]`) ?? active.node;
}

const dropAnimation: DropAnimation = {
  duration: DROP_MS,
  easing: DROP_EASING,
  keyframes({ active, dragOverlay, transform }) {
    const { initial } = transform;
    // Measure from the wrapper's box: the lifted note inflates the overlay's own bounding box.
    const wrapper = dragOverlay.node.getBoundingClientRect();
    const slot = landingSlot(active);
    // The landed slot may already be mid-FLIP, translated back toward where it came from; the copy
    // is what the eye follows, so cancel that and measure the slot's true resting place.
    for (const a of slot.getAnimations()) a.cancel();
    const target = slot.getBoundingClientRect();
    const final = { x: initial.x + (target.left - wrapper.left), y: initial.y + (target.top - wrapper.top) };
    return [
      { transform: `translate3d(${initial.x}px, ${initial.y}px, 0)` },
      { transform: `translate3d(${final.x}px, ${final.y}px, 0)` },
    ];
  },
  sideEffects({ active, dragOverlay }) {
    const slot = landingSlot(active);
    slot.style.opacity = "0";
    dragOverlay.node.querySelector(".note")?.classList.add("note--settling");
    return () => { slot.style.opacity = ""; };
  },
};

function BoardColumn({ column, children }: { column: Column; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, data: { sectionId: column.section_id ?? null } });
  const variant = column.key === BACKLOG_KEY ? "backlog" : "section";
  return (
    <section ref={setNodeRef} aria-label={column.label} data-column-key={column.key} className={`board-column board-column--${variant} ${isOver ? "board-column--over" : ""}`}>
      <div className="board-column-header"><span>{column.label}</span><span className="board-column-count">{column.items.length}</span></div>
      <ul className="board-column-body">{column.items.length === 0 ? <li className="board-column-empty">Nothing here</li> : children}</ul>
    </section>
  );
}

export function TodoistBoard({ state, send }: CustomProps) {
  const board = state as BoardState | null;
  const t = useTasks(board, send);
  const [active, setActive] = useState<{ item: Task; fromKey: string } | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: DRAG_DISTANCE_PX } }),
    useSensor(TouchSensor, { activationConstraint: { delay: HOLD_TO_DRAG_MS, tolerance: HOLD_TOLERANCE_PX } }),
  );
  const boardRef = useRef<HTMLDivElement>(null);
  useFlip(boardRef, [t.columns, t.leaving]);
  if (!board) return null;

  function onDragStart(e: DragStartEvent) {
    t.setOpenId(null);
    lastDrop = null;
    setActive(e.active.data.current as { item: Task; fromKey: string });
  }
  function onDragEnd(e: DragEndEvent) {
    const dragged = active;
    setActive(null);
    if (!dragged || !e.over) return;
    const toKey = String(e.over.id);
    if (toKey === dragged.fromKey) { lastDrop = null; return; }
    lastDrop = { id: dragged.item.id, toKey };
    // Commit the optimistic move now, so the drop animation that follows can measure the card in its new column.
    flushSync(() => t.move(dragged.item, toKey, (e.over!.data.current as { sectionId: string | null }).sectionId));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="board" ref={boardRef} style={MOTION_VARS}>
        {t.columns.map((col) => (
          <BoardColumn key={col.key} column={col}>
            {col.items.map((item) => (
              <NoteSlot key={item.id} item={item} columnKey={col.key} draggable leaving={t.leaving.has(item.id)} open={t.openId === item.id} onTap={() => t.setOpenId(t.openId === item.id ? null : item.id)} onDone={() => t.complete(item)} />
            ))}
          </BoardColumn>
        ))}
      </div>
      {createPortal(
        <DragOverlay dropAnimation={dropAnimation} style={MOTION_VARS}>{active && <Note item={active.item} columnKey={active.fromKey} className="note--overlay" />}</DragOverlay>,
        document.body,
      )}
      {t.notice && <NoticeToast notice={t.notice} onUndo={t.undo} onDismiss={() => t.setNotice(null)} />}
    </DndContext>
  );
}

// ─── List ───────────────────────────────────────────────────────────────────

export function TodoistList({ state, send }: CustomProps) {
  const board = state as BoardState | null;
  const t = useTasks(board, send);
  // No sensors: the list never drags, but its notes share NoteSlot, which needs a DndContext.
  const sensors = useSensors();
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, [t.columns, t.leaving]);
  if (!board) return null;
  return (
    <DndContext sensors={sensors}>
      <div className="task-list" ref={listRef} style={MOTION_VARS}>
        {t.columns.filter((col) => col.items.length > 0).map((col) => (
          <section key={col.key} className="task-list-section">
            <h3 className="task-list-heading">{col.label} <span className="board-column-count">{col.items.length}</span></h3>
            <ul className="task-list-body">
              {col.items.map((item) => (
                <NoteSlot key={item.id} item={item} columnKey={col.key} draggable={false} leaving={t.leaving.has(item.id)} open={t.openId === item.id} onTap={() => t.setOpenId(t.openId === item.id ? null : item.id)} onDone={() => t.complete(item)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {t.notice && <NoticeToast notice={t.notice} onUndo={t.undo} onDismiss={() => t.setNotice(null)} />}
    </DndContext>
  );
}
