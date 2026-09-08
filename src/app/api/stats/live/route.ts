import { backendFetch, proxyJson } from "../../_lib/backend";
import { withScannerAuth } from "../../_lib/session";

export const dynamic = "force-dynamic";

/** Venue-wide admitted / total for the header. */
export const GET = withScannerAuth(async ({ req, token }) => {
  const up = await backendFetch("GET", "stats/live", { req, token, timeoutMs: 4000 });
  return proxyJson(up, { fallbackMessage: "Could not load counts." });
});
