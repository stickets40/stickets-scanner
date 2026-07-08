import { NextResponse } from "next/server";

/**
 * Scanner BFF helpers. All calls to the stickets backend go through these
 * server-side route handlers so the scanner JWT lives ONLY in an httpOnly+Secure
 * cookie and is never exposed to client JS (fixes the localStorage/JS-cookie
 * token exposure from the audit).
 */
export const SCANNER_COOKIE = "scanner-token";

const TOKEN_MAX_AGE = 60 * 60 * 24; // 24h — matches the backend scanner JWT TTL.

/** Backend scanner API base, e.g. http://localhost:3000/api/scanner (server-only). */
export function backendBase(): string {
  const url = process.env.SCANNER_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    // Fail closed in production rather than silently proxying to localhost.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SCANNER_BACKEND_URL (or NEXT_PUBLIC_API_URL) must be set in production."
      );
    }
    return "http://localhost:3000/api/scanner";
  }
  return url.replace(/\/+$/, "");
}

const isProd = process.env.NODE_ENV === "production";

/** Attach the scanner token as an httpOnly + Secure + SameSite=Strict cookie. */
export function setTokenCookie(res: NextResponse, token: string): void {
  res.cookies.set(SCANNER_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: TOKEN_MAX_AGE,
  });
}

export function clearTokenCookie(res: NextResponse): void {
  res.cookies.set(SCANNER_COOKIE, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

/** POST JSON to a backend scanner path, returning the parsed body + status. */
export async function backendPost(
  path: string,
  body: unknown,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${backendBase()}/${path.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Version": "1.0.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    // Never cache auth/scan calls.
    cache: "no-store",
  });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

/** Extract a human message from a backend error envelope. */
export function backendMessage(body: unknown, fallback: string): string {
  const b = body as
    | { message?: string; error?: { message?: string } }
    | null
    | undefined;
  return b?.message ?? b?.error?.message ?? fallback;
}
