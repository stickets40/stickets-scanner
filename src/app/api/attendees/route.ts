import { z } from "zod";
import { backendFetch, proxyJson } from "../_lib/backend";
import { withScannerAuth } from "../_lib/session";
import { readQuery } from "../_lib/validate";

export const dynamic = "force-dynamic";

// Control characters are stripped BEFORE the length check so a pasted line
// break cannot smuggle an empty search through.
const CONTROL_CHARS = /\p{Cc}/gu;
const schema = z.object({
  q: z
    .string()
    .transform((s) => s.replace(CONTROL_CHARS, " ").trim())
    .pipe(z.string().min(2).max(64)),
});

/** Door lookup by holder name / email prefix (≤ 10 rows, masked email). */
export const GET = withScannerAuth(async ({ req, token }) => {
  const parsed = readQuery(req, schema);
  if (!parsed.ok) return parsed.res;
  const up = await backendFetch("GET", "attendees", { req, token, search: { q: parsed.data.q } });
  return proxyJson(up, { fallbackMessage: "Search failed." });
});
