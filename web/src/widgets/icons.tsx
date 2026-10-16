import type { ComponentType, CSSProperties } from "react";
import {
  Activity, AtSign, Bell, Hash, Inbox, CalendarDays, ChartLine, Circle, Clock, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow,
  CloudSun, Cpu, Database, Gauge, HardDrive, ListTodo, Mail, MemoryStick, MessageSquare, Moon, Newspaper, Rss, Server, Sparkles,
  Sun, Timer, TrendingDown, TrendingUp, Zap,
} from "lucide-react";

type IconProps = { size?: number; className?: string; style?: CSSProperties; "aria-hidden"?: boolean; "data-icon"?: string };

/** The Redis mark: three stacked slabs. Hand drawn here because Lucide ships no brand logos. */
function RedisMark({ size = 20, className, style, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} {...rest}>
      <path d="M12 3 3.5 6.8 12 10.6l8.5-3.8L12 3Zm-8.5 7.2v2.2L12 16.2l8.5-3.8v-2.2L12 14 3.5 10.2Zm0 4.6V17L12 20.8l8.5-3.8v-2.2L12 18.6l-8.5-3.8Z" />
    </svg>
  );
}

/** The icons Lua views may name. Add entries here to make more available. */
const ICONS: Record<string, ComponentType<IconProps>> = {
  gauge: Gauge,
  "at-sign": AtSign,
  hash: Hash,
  inbox: Inbox,
  calendar: CalendarDays,
  "chart-line": ChartLine,
  clock: Clock,
  "list-todo": ListTodo,
  newspaper: Newspaper,
  rss: Rss,
  sparkles: Sparkles,
  "hard-drive": HardDrive,
  server: Server,
  zap: Zap,
  redis: RedisMark,
  activity: Activity,
  bell: Bell,
  cpu: Cpu,
  database: Database,
  "memory-stick": MemoryStick,
  timer: Timer,
  cloud: Cloud,
  "cloud-drizzle": CloudDrizzle,
  "cloud-fog": CloudFog,
  "cloud-lightning": CloudLightning,
  "cloud-rain": CloudRain,
  "cloud-snow": CloudSnow,
  "cloud-sun": CloudSun,
  mail: Mail,
  "message-square": MessageSquare,
  moon: Moon,
  sun: Sun,
  "trending-down": TrendingDown,
  "trending-up": TrendingUp,
};

export function Icon({ name, size = 20, className, style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  const Component = ICONS[name] ?? Circle;
  return <Component size={size} className={className} style={style} aria-hidden data-icon={name} />;
}
