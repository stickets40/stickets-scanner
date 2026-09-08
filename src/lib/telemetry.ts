/**
 * Fire-and-forget device telemetry to the BFF (/api/telemetry). Throttled per
 * type so a stuck camera cannot flood the server, and NEVER carries a QR
 * payload — the route scrubs `payload` keys as a second line of defence.
 */
import { getDeviceId } from "@/lib/device-id";

const THROTTLE_MS = 10_000;
const lastSent = new Map<string, number>();
const recent: Array<{ at: string; type: string; data?: Record<string, unknown> }> = [];
export const RECENT_TELEMETRY_MAX = 25;

export function recentTelemetry(): ReadonlyArray<{ at: string; type: string; data?: Record<string, unknown> }> {
  return recent;
}

export function beacon(type: string, data?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const at = new Date(now).toISOString();
  recent.push({ at, type, data });
  if (recent.length > RECENT_TELEMETRY_MAX) recent.shift();

  const last = lastSent.get(type) ?? 0;
  if (now - last < THROTTLE_MS) return;
  lastSent.set(type, now);

  const body = JSON.stringify({
    type,
    at,
    deviceId: getDeviceId(),
    buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
    ua: navigator.userAgent.slice(0, 200),
    online: navigator.onLine,
    ...(data ? { data } : {}),
  });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon("/api/telemetry", new Blob([body], { type: "application/json" }))) return;
  } catch {
    /* fall through to fetch */
  }
  void fetch("/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}
