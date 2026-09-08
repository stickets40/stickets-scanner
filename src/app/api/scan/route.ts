import { z } from "zod";
import { backendFetch, proxyJson } from "../_lib/backend";
import { withScannerAuth } from "../_lib/session";
import { DEVICE_ID_RE, deviceIdOf, readJson } from "../_lib/validate";

export const dynamic = "force-dynamic";

const schema = z.object({
  payload: z.string().min(1).max(2048),
  scanId: z.uuid(),
  deviceId: z.string().regex(DEVICE_ID_RE).optional(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  source: z.enum(["live", "offline_replay", "manual"]).optional(),
  includeCounters: z.boolean().optional(),
  offlineVerdict: z.string().max(20).optional(),
});

/** One live scan. Every verdict is HTTP 200; transport failures are 502/504 for the client to fall back on. */
export const POST = withScannerAuth(async ({ req, token }) => {
  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const deviceId = deviceIdOf(req, parsed.data);
  const up = await backendFetch("POST", "scan", {
    req,
    token,
    deviceId,
    body: { ...parsed.data, deviceId },
    timeoutMs: 6000,
  });
  return proxyJson(up, { fallbackMessage: "Scan failed." });
});
