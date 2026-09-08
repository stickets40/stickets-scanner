import { NextResponse } from "next/server";
import { backendBase } from "../_lib/backend";

export const dynamic = "force-dynamic";

const PROBE_TTL_MS = 10_000;
let lastProbe: { at: number; upstream: "ok" | "down" } | null = null;

/**
 * Reachability probe for the client connectivity monitor (no auth, tiny,
 * uncached). `upstream` is a cached (10 s) ping of the backend root health
 * route so a venue full of devices does not turn the probe into a load test.
 */
export async function GET() {
  let upstream: "ok" | "down" | "unknown" = "unknown";
  const now = Date.now();
  if (lastProbe && now - lastProbe.at < PROBE_TTL_MS) {
    upstream = lastProbe.upstream;
  } else {
    try {
      const base = backendBase().replace(/\/api\/scanner\/?$/, "");
      const res = await fetch(`${base}/health`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
      upstream = res.ok ? "ok" : "down";
    } catch {
      upstream = "down";
    }
    lastProbe = { at: now, upstream };
  }
  const res = NextResponse.json({
    ok: true,
    serverTime: new Date().toISOString(),
    buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
    upstream,
  });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Server-Time", new Date().toISOString());
  return res;
}
