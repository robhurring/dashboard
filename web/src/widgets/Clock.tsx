import { useEffect, useState } from "react";

export type ClockStyle = "digital" | "analog";
type Props = {
  tz?: string;
  label?: string;
  seconds?: boolean;
  style?: ClockStyle;
  /** Time format tokens: HH H hh h mm ss A a, plus date tokens; [literal] text in brackets. Default "HH:mm" (+":ss" with seconds). */
  format?: string;
  /** A date line under the time: true for "ddd, MMM D", or a format of YYYY MM M DD D dddd ddd MMMM MMM tokens. */
  date?: boolean | string;
};

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string; monthName: string };

const DEFAULT_DATE = "ddd, MMM D";
const TOKEN = /\[([^\]]*)\]|YYYY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A|a/g;

function partsIn(now: Date, tz: string | undefined): Parts {
  const numeric: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" };
  const names: Intl.DateTimeFormatOptions = { weekday: "long", month: "long" };
  let n: Intl.DateTimeFormatPart[], w: Intl.DateTimeFormatPart[];
  try {
    n = new Intl.DateTimeFormat("en-US", { ...numeric, timeZone: tz }).formatToParts(now);
    w = new Intl.DateTimeFormat("en-US", { ...names, timeZone: tz }).formatToParts(now);
  } catch {
    n = new Intl.DateTimeFormat("en-US", numeric).formatToParts(now); // unknown zone: local time
    w = new Intl.DateTimeFormat("en-US", names).formatToParts(now);
  }
  const num = (type: string) => Number(n.find((p) => p.type === type)?.value ?? 0);
  const str = (type: string) => w.find((p) => p.type === type)?.value ?? "";
  return { year: num("year"), month: num("month"), day: num("day"), hour: num("hour") % 24, minute: num("minute"), second: num("second"), weekday: str("weekday"), monthName: str("month") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Formats `now` in zone `tz` with the token format above. Exported for tests and custom components. */
export function formatTime(now: Date, tz: string | undefined, format: string): string {
  const p = partsIn(now, tz);
  const h12 = p.hour % 12 || 12;
  return format.replace(TOKEN, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case "YYYY": return String(p.year);
      case "MMMM": return p.monthName;
      case "MMM": return p.monthName.slice(0, 3);
      case "MM": return pad(p.month);
      case "M": return String(p.month);
      case "dddd": return p.weekday;
      case "ddd": return p.weekday.slice(0, 3);
      case "DD": return pad(p.day);
      case "D": return String(p.day);
      case "HH": return pad(p.hour);
      case "H": return String(p.hour);
      case "hh": return pad(h12);
      case "h": return String(h12);
      case "mm": return pad(p.minute);
      case "ss": return pad(p.second);
      case "A": return p.hour < 12 ? "AM" : "PM";
      case "a": return p.hour < 12 ? "am" : "pm";
      default: return token;
    }
  });
}

function Analog({ now, tz, seconds, title }: { now: Date; tz?: string; seconds: boolean; title: string }) {
  const p = partsIn(now, tz);
  const hour = (p.hour % 12) * 30 + p.minute * 0.5;
  const minute = p.minute * 6;
  const second = p.second * 6;
  return (
    <svg role="img" aria-label={title} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="min-h-0 w-full flex-1">
      <circle cx="50" cy="50" r="48" className="fill-canvas stroke-ink-muted" strokeWidth="2" />
      <g transform="translate(50 50)">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="0" y1="-44" x2="0" y2={i % 3 === 0 ? "-36" : "-40"} transform={`rotate(${i * 30})`} className="stroke-ink-muted" strokeWidth={i % 3 === 0 ? 3 : 1.5} strokeLinecap="round" />
        ))}
        <line data-hand="hour" x1="0" y1="4" x2="0" y2="-24" transform={`rotate(${hour})`} className="stroke-ink" strokeWidth="5" strokeLinecap="round" />
        <line data-hand="minute" x1="0" y1="4" x2="0" y2="-36" transform={`rotate(${minute})`} className="stroke-ink" strokeWidth="3.5" strokeLinecap="round" />
        {seconds && <line data-hand="second" x1="0" y1="8" x2="0" y2="-40" transform={`rotate(${second})`} className="stroke-accent" strokeWidth="1.5" strokeLinecap="round" />}
        <circle r="3" className="fill-accent" />
      </g>
    </svg>
  );
}

/** Ticks once a second in the browser; no server traffic. */
export function Clock({ tz, label, seconds = false, style = "digital", format, date }: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const timeFormat = format || (seconds ? "HH:mm:ss" : "HH:mm");
  const time = formatTime(now, tz, timeFormat);
  const dateLine = date ? formatTime(now, tz, typeof date === "string" ? date : DEFAULT_DATE) : null;
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center text-center">
      {style === "analog" ? <Analog now={now} tz={tz} seconds={seconds} title={time} /> : <span className="type-hero">{time}</span>}
      {dateLine && <span className="type-row mt-3">{dateLine}</span>}
      {label && <span className="type-sub mt-1">{label}</span>}
    </div>
  );
}
