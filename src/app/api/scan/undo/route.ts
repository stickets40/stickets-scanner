import { z } from "zod";
import { backendFetch, proxyJson } from "../../_lib/backend";
import { withScannerAuth } from "../../_lib/session";
import { DEVICE_ID_RE, deviceIdOf, readJson } from "../../_lib/validate";

export const dynamic = "force-dynamic";

const schema = z.object({
  scanLogId: z.uuid(),
  deviceId: z.string().regex(DEVICE_ID_RE).optional(),
});

/** Revert an admission this device made in the last five minutes. */
export const POST = withScannerAuth(async ({ req, token }) => {
  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const deviceId = deviceIdOf(req, parsed.data);
  const up = await backendFetch("POST", "scan/undo", {
    req,
    token,
    deviceId,
    body: { scanLogId: parsed.data.scanLogId, deviceId },
  });
  return proxyJson(up, { fallbackMessage: "Could not undo." });
});
