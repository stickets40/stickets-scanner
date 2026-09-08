import { NextResponse } from "next/server";
import { backendFetch, proxyJson } from "../../_lib/backend";
import { readAuthPayload, setSessionCookies, withScannerAuth } from "../../_lib/session";

export const dynamic = "force-dynamic";

/** Explicit renewal ("Renew now" in settings, or the client noticing expiry is near). */
export const POST = withScannerAuth(async ({ req, token }) => {
  const up = await backendFetch("POST", "auth/refresh", { req, token, body: {} });
  const auth = readAuthPayload(up);
  if (up.status < 200 || up.status >= 300 || !auth) return proxyJson(up, { fallbackMessage: "Could not renew the session." });
  const res = NextResponse.json({ scanner: auth.scanner, expiresAt: auth.expiresAt ?? null, deviceId: auth.deviceId ?? null });
  res.headers.set("Cache-Control", "no-store");
  setSessionCookies(res, auth.accessToken);
  return res;
});
