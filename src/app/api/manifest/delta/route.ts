import { z } from "zod";
import { backendFetch, proxyJson } from "../../_lib/backend";
import { withScannerAuth } from "../../_lib/session";
import { readQuery } from "../../_lib/validate";

export const dynamic = "force-dynamic";

const schema = z.object({
  since: z.iso.datetime({ offset: true }),
  cursor: z.string().max(88).optional(),
  limit: z.string().regex(/^\d{1,4}$/).optional(),
});

/** Manifest rows changed since `since` (backend refuses > 30 days with DELTA_TOO_OLD). */
export const GET = withScannerAuth(async ({ req, token }) => {
  const parsed = readQuery(req, schema);
  if (!parsed.ok) return parsed.res;
  const up = await backendFetch("GET", "manifest/delta", {
    req,
    token,
    search: { since: parsed.data.since, cursor: parsed.data.cursor, limit: parsed.data.limit },
    timeoutMs: 15000,
  });
  return proxyJson(up, { fallbackMessage: "Could not refresh offline data." });
});
