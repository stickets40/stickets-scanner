import { getMeta, setMeta } from "@/lib/idb";

/**
 * Corrected clock. A venue phone's clock can be minutes off (roaming, manual
 * settings, a dead battery). Offline decisions that depend on time — the scan
 * window, "admitted X ago" — use server time estimated from every response:
 * skew = serverTime − midpoint(request start, end), smoothed over the last
 * five samples and persisted so the estimate survives a relaunch.
 */
const MAX_SAMPLES = 5;
const META_KEY = "clock";

let samples: number[] = [];
let skewMs = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function getSkewMs(): number {
  return skewMs;
}

export async function loadClock(): Promise<void> {
  try {
    const saved = await getMeta<{ skewMs: number }>(META_KEY);
    if (saved && Number.isFinite(saved.skewMs)) {
      skewMs = saved.skewMs;
      samples = [saved.skewMs];
    }
  } catch {
    /* IDB unavailable — start at zero skew */
  }
}

export function recordServerTime(iso: string, timing: { startedAt: number; endedAt: number }): void {
  const server = Date.parse(iso);
  if (!Number.isFinite(server)) return;
  const midpoint = (timing.startedAt + timing.endedAt) / 2;
  const rtt = timing.endedAt - timing.startedAt;
  // A very slow response carries a noisy estimate; keep it but let good ones dominate.
  if (rtt > 15_000) return;
  samples.push(server - midpoint);
  if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
  skewMs = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void setMeta(META_KEY, { skewMs }).catch(() => {});
  }, 2000);
}

/** Corrected "now" in ms. */
export function now(): number {
  return Date.now() + skewMs;
}

export function nowIso(): string {
  return new Date(now()).toISOString();
}

export function elapsedSince(iso: string): number {
  const then = Date.parse(iso);
  return Number.isFinite(then) ? Math.max(0, now() - then) : 0;
}

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  return `${Math.round(seconds / 60)} min`;
}

/** "just now" / "4 min ago" / "2h ago". */
export function formatElapsed(iso: string, nowMs = now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "earlier";
  const seconds = Math.max(0, (nowMs - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return "earlier today";
}

/** Duration label for a positive span in ms: "40s", "12 min", "3h 05m". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

export function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

/** Test helper. */
export function resetClock(): void {
  samples = [];
  skewMs = 0;
}
