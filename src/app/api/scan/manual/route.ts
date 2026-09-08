import { z } from "zod";
import { backendFetch, proxyJson } from "../../_lib/backend";
import { withScannerAuth } from "../../_lib/session";
import { BASE58_TOKEN_RE, DEVICE_ID_RE, deviceIdOf, readJson } from "../../_lib/validate";

export const dynamic = "force-dynamic";

const schema = z.object({
  tokenId: z.string().regex(BASE58_TOKEN_RE),
  scanId: z.uuid(),
  note: z.string().trim().max(140).optional(),
  deviceId: z.string().regex(DEVICE_ID_RE).optional(),
});

/** Manual check-in after a name/email lookup — same atomic path as a scan. */
export const POST = withScannerAuth(async ({ req, token }) => {
  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const deviceId = deviceIdOf(req, parsed.data);
  const up = await backendFetch("POST", "scan/manual", {
    req,
    token,
    deviceId,
    body: { ...parsed.data, deviceId },
  });
  return proxyJson(up, { fallbackMessage: "Check-in failed." });
});
