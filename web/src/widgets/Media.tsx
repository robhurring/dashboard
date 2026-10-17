import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";

/*
 * Images and audio from a module, either inline as base64 (`data`, with its `type`) or from a URL
 * (`src`). Inline data needs no storage anywhere: it travels with the panel's state.
 */
function source(data: string | undefined, src: string | undefined, type: string): string | undefined {
  if (src) return src;
  if (!data) return undefined;
  return data.startsWith("data:") ? data : `data:${type};base64,${data}`;
}

type ImageProps = { data?: string; src?: string; type?: string; alt?: string; fit?: "contain" | "cover" };

export function ImageWidget({ data, src, type = "image/png", alt = "", fit = "contain" }: ImageProps) {
  const url = source(data, src, type);
  if (!url) return null;
  return <img src={url} alt={alt} className={`h-full min-h-0 w-full rounded-lg ${fit === "cover" ? "object-cover" : "object-contain"}`} />;
}

type AudioProps = { data?: string; src?: string; type?: string; label?: string; autoplay?: boolean };

/**
 * A play and stop button for a clip. With `autoplay`, each new clip plays as it arrives (an
 * announcement), but not the one already on screen when the page loads. If the browser blocks
 * playing without a tap first, the button stays there to play it by hand.
 */
export function AudioWidget({ data, src, type = "audio/mpeg", label, autoplay = false }: AudioProps) {
  const url = source(data, src, type);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!autoplay || !url || !audio.current) return;
    audio.current.currentTime = 0;
    audio.current.play().catch(() => setPlaying(false));
  }, [url, autoplay]);

  if (!url) return null;
  const name = label ?? "audio";
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) { el.pause(); el.currentTime = 0; setPlaying(false); }
    else { el.currentTime = 0; el.play().catch(() => setPlaying(false)); }
  };
  return (
    <div className="flex min-w-0 items-center gap-[0.6em]">
      <audio ref={audio} src={url} preload="auto" onPlay={() => setPlaying(true)} onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} />
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? "Stop" : "Play"} ${name}`}
        className="flex size-[2.4em] shrink-0 items-center justify-center rounded-full bg-accent text-canvas"
      >
        {playing ? <Square className="size-[0.9em]" fill="currentColor" /> : <Play className="size-[1em] translate-x-[0.06em]" fill="currentColor" />}
      </button>
      {label && <span className="type-row truncate">{label}</span>}
    </div>
  );
}
