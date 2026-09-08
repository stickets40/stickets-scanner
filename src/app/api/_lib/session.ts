import { NextResponse, type NextRequest } from "next/server";
import {
  backendFetch,
  bffError,
  SCANNER_COOKIE,
  SESSION_HINT_COOKIE,
  unwrapData,
  type BackendResult,
} from "./backend";

const isProd = process.env.NODE_ENV === "production";
const DAY_S = 60 * 60 * 24;
/** Renew when less than this much of the session is left. */
export const REFRESH_AHEAD_MS = 6 * 60 * 60 * 1000;
/** Cookie lifetime fallback when the token carries no readable exp. */
const FALLBACK_TOKEN_MAX_AGE_S = DAY_S;

/** exp claim (ms) from a JWT without verifying it — sizing the cookie only; the backend verifies. */
export function decodeJwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function setSessionCookies(res: NextResponse, token: string): void {
  const expMs = decodeJwtExpMs(token);
  const maxAge = expMs
    ? Math.max(60, Math.floor((expMs - Date.now()) / 1000))
    : FALLBACK_TOKEN_MAX_AGE_S;
  res.cookies.set(SCANNER_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge,
  });
  // The hint outlives the token: an expired session must still be able to
  // open the (cached) shell offline and show the inline re-auth form.
  res.cookies.set(SESSION_HINT_COOKIE, "1", {
    httpOnly: false,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: 30 * DAY_S,
  });
}

export function clearSessionCookies(res: NextResponse, opts: { keepHint?: boolean } = {}): void {
  res.cookies.set(SCANNER_COOKIE, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  if (!opts.keepHint) {
    res.cookies.set(SESSION_HINT_COOKIE, "", {
      httpOnly: false,
      secure: isProd,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
  }
}

export interface AuthPayload {
  accessToken: string;
  expiresAt?: string;
  deviceId?: string;
  scanner?: unknown;
}

/** Read the backend login/refresh envelope. */
export function readAuthPayload(up: BackendResult): AuthPayload | null {
  const data = unwrapData(up.body) as Partial<AuthPayload> | null;
  if (!data || typeof data.accessToken !== "string" || !data.accessToken) return null;
  return {
    accessToken: data.accessToken,
    expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : undefined,
    deviceId: typeof data.deviceId === "string" ? data.deviceId : undefined,
    scanner: data.scanner,
  };
}

/**
 * Silent renewal: when the token is within REFRESH_AHEAD_MS of expiry, ask the
 * backend for a fresh one. Returns null when no renewal is due or it failed
 * (the current token keeps working until it actually expires).
 */
export async function maybeRefresh(token: string, req: NextRequest): Promise<AuthPayload | null> {
  const expMs = decodeJwtExpMs(token);
  if (expMs && expMs - Date.now() > REFRESH_AHEAD_MS) return null;
  const up = await backendFetch("POST", "auth/refresh", { token, req, body: {} });
  if (up.status < 200 || up.status >= 300) return null;
  return readAuthPayload(up);
}

export type ScannerHandler = (ctx: { req: NextRequest; token: string }) => Promise<NextResponse>;

/**
 * Wrap an authenticated BFF route:
 *  - no cookie → 401 NO_SESSION (the client shows the inline re-auth form)
 *  - upstream 401 → the backend's code passes through; the token cookie is
 *    cleared but the hint stays so the shell remains reachable offline
 *  - 2xx → renew the token when it is close to expiry; every response carries
 *    X-Session-Expires-At (and X-Session-Renewal: 1 when a new cookie was set)
 */
export function withScannerAuth(handler: ScannerHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const token = req.cookies.get(SCANNER_COOKIE)?.value;
    if (!token) {
      const res = bffError(401, "Not signed in on this device.", "NO_SESSION");
      res.headers.set("Cache-Control", "no-store");
      return res;
    }

    const res = await handler({ req, token });

    if (res.status === 401) {
      clearSessionCookies(res, { keepHint: true });
      return res;
    }

    if (res.status >= 200 && res.status < 300) {
      const renewed = await maybeRefresh(token, req).catch(() => null);
      if (renewed) {
        setSessionCookies(res, renewed.accessToken);
        res.headers.set("X-Session-Renewal", "1");
        const exp = renewed.expiresAt ?? isoFromExp(decodeJwtExpMs(renewed.accessToken));
        if (exp) res.headers.set("X-Session-Expires-At", exp);
      } else {
        const exp = isoFromExp(decodeJwtExpMs(token));
        if (exp) res.headers.set("X-Session-Expires-At", exp);
      }
    }
    return res;
  };
}

function isoFromExp(expMs: number | null): string | null {
  return expMs ? new Date(expMs).toISOString() : null;
}
