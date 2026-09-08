import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { backendErrorCode, backendFetch, backendMessage, bffError, proxyJson } from "../../_lib/backend";
import { readAuthPayload, setSessionCookies } from "../../_lib/session";
import { DEVICE_ID_RE, deviceIdOf, readJson } from "../../_lib/validate";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(256),
  deviceId: z.string().regex(DEVICE_ID_RE).optional(),
});

/** Account login (username/password) → httpOnly token cookie, returns profile + expiry. */
export async function POST(req: NextRequest) {
  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const deviceId = deviceIdOf(req, parsed.data);

  const up = await backendFetch("POST", "auth/login", {
    req,
    deviceId,
    body: { username: parsed.data.username, password: parsed.data.password, deviceId },
  });
  const auth = readAuthPayload(up);
  if (up.status < 200 || up.status >= 300 || !auth) {
    if (up.timedOut || up.networkError) return proxyJson(up);
    return bffError(
      up.status >= 400 ? up.status : 401,
      backendMessage(up.body, "Those details weren't accepted."),
      backendErrorCode(up.body) ?? "LOGIN_FAILED"
    );
  }

  const res = NextResponse.json({ scanner: auth.scanner, expiresAt: auth.expiresAt ?? null, deviceId: auth.deviceId ?? deviceId ?? null });
  res.headers.set("Cache-Control", "no-store");
  setSessionCookies(res, auth.accessToken);
  return res;
}
