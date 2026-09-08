import { z } from "zod";
import { backendFetch, proxyJson } from "../_lib/backend";
import { withScannerAuth } from "../_lib/session";
import { readQuery } from "../_lib/validate";

export const dynamic = "force-dynamic";

const schema = z.object({
  cursor: z.string().max(88).optional(),
  limit: z.string().regex(/^\d{1,4}$/).optional(),
});

/** Full offline manifest page (keyset paging on the backend). */
export const GET = withScannerAuth(async ({ req, token }) => {
  const parsed = readQuery(req, schema);
  if (!parsed.ok) return parsed.res;
  const up = await backendFetch("GET", "manifest", {
    req,
    token,
    search: { cursor: parsed.data.cursor, limit: parsed.data.limit },
    timeoutMs: 15000,
  });
  return proxyJson(up, { fallbackMessage: "Could not load offline data." });
});
