import { z } from "zod";
import { backendFetch, proxyJson } from "../../_lib/backend";
import { withScannerAuth } from "../../_lib/session";
import { DEVICE_ID_RE, deviceIdOf, readJson } from "../../_lib/validate";

export const dynamic = "force-dynamic";

const BATCH_MAX = 50;

const schema = z.object({
  scans: z
    .array(
      z.object({
        payload: z.string().min(1).max(2048),
        scanId: z.uuid(),
        capturedAt: z.iso.datetime({ offset: true }).optional(),
        offlineVerdict: z.string().max(20).optional(),
      })
    )
    .min(1)
    .max(BATCH_MAX),
  deviceId: z.string().regex(DEVICE_ID_RE).optional(),
});

/** Offline-queue replay: ≤ 50 scans, every result echoes its scanId. */
export const POST = withScannerAuth(async ({ req, token }) => {
  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const deviceId = deviceIdOf(req, parsed.data);
  const up = await backendFetch("POST", "scan/batch", {
    req,
    token,
    deviceId,
    body: { scans: parsed.data.scans, deviceId },
    timeoutMs: 10000,
  });
  return proxyJson(up, { fallbackMessage: "Sync failed." });
});
