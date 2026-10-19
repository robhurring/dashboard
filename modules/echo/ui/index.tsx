import { useState, type FormEvent } from "react";
import type { CustomProps } from "@dashboard/components/registry";

/*
 * The example module's screen. It receives the module's state and a `send` function, and talks back
 * only through commands: it never changes `state` itself. When a command returns new state, the
 * server pushes it to every screen and this component re-renders with it.
 */

type Message = { text: string; at: number };
type EchoState = { messages: Message[]; pings: number };

export function Echo({ state, send }: CustomProps) {
  const { messages = [], pings = 0 } = (state ?? {}) as Partial<EchoState>;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Runs a command. The promise settles when the module's command has finished. */
  async function run(action: string, args?: { text: string }) {
    setBusy(true);
    setError(null);
    try {
      await send(action, args);
      if (action === "echo") setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run("echo", { text });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something"
          className="min-w-0 flex-1 rounded-md bg-ink/5 px-3 py-2 text-ink outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-accent"
        />
        <button type="submit" disabled={busy} className="rounded-md bg-accent px-3 py-2 font-semibold text-canvas disabled:opacity-50">Echo</button>
        <button type="button" disabled={busy} onClick={() => void run("ping")} className="rounded-md bg-ink/10 px-3 py-2 font-semibold disabled:opacity-50">Ping</button>
      </form>
      {error && <p role="alert" className="type-sub text-bad">{error}</p>}
      <p className="type-sub">{pings} {pings === 1 ? "pong" : "pongs"}</p>
      <ul className="flex min-h-0 flex-col gap-1 scroll">
        {messages.length === 0 && <li className="type-sub italic">Nothing yet</li>}
        {messages.map((m, i) => (
          <li key={`${m.at}-${i}`} className="rounded-md bg-ink/5 px-3 py-1.5">{m.text}</li>
        ))}
      </ul>
    </div>
  );
}
