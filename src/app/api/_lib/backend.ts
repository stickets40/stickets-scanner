import { NextResponse, type NextRequest } from "next/server";

/**
 * Scanner BFF ↔ backend transport.
 *
 * Every backend call goes through these server-side route handlers so the
 * scanner JWT lives ONLY in an httpOnly+Secure cookie. This module owns the
 * trust headers the backend requires from the BFF, the request timeout, and
 * the normalisation of "the backend is unreachable" into something the client
 * can reason about (504 UPSTREAM_TIMEOUT / 502 UPSTREAM_UNREACHABLE) instead
 * of a thrown fetch error that reads like a bad ticket.
 */
export const SCANNER_COOKIE = "scanner-token";
/** Non-httpOnly marker: "this device has signed in before" — keeps the shell reachable offline. */
export const SESSION_HINT_COOKIE = "scanner-session-hint";

export const DEFAULT_TIMEOUT_MS = 6000;

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

/**
 * The origin the backend must see on every proxied call. The backend's CORS /
 * no-Origin guard rejects header-less server-to-server traffic in production;
 * the BFF therefore identifies itself with the scanner's own public origin
 * (which must be in the backend's ALLOWED_ORIGINS) plus X-Internal-Key.
 */
export function publicOrigin(req?: NextRequest): string {
  const configured = process.env.SCANNER_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (!req) return "http://localhost:3002";
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

/** First hop of X-Forwarded-For, else the socket address Next exposes. */
export function clientIp(req?: NextRequest): string | null {
  if (!req) return null;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? null;
}

export interface BackendResult {
  status: number;
  body: unknown;
  headers: Headers;
  timedOut: boolean;
  networkError: boolean;
}

export interface BackendFetchOptions {
  token?: string;
  body?: unknown;
  /** The inbound request — source of the forwarded client IP and device id. */
  req?: NextRequest;
  timeoutMs?: number;
  search?: Record<string, string | undefined>;
  deviceId?: string;
}

const EMPTY_HEADERS = new Headers();

/** One backend call. Never throws: transport failures come back as 502/504 results. */
export async function backendFetch(
  method: "GET" | "POST",
  path: string,
  opts: BackendFetchOptions = {}
): Promise<BackendResult> {
  const url = new URL(`${backendBase()}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(opts.search ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    "X-API-Version": "1.0.0",
    Origin: publicOrigin(opts.req),
    "X-Request-Id": crypto.randomUUID(),
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const internalKey = process.env.INTERNAL_API_KEY?.trim();
  if (internalKey) {
    headers["X-Internal-Key"] = internalKey;
    const ip = clientIp(opts.req);
    if (ip) headers["X-Client-IP"] = ip;
  }
  const deviceId = opts.deviceId ?? opts.req?.headers.get("x-device-id") ?? undefined;
  if (deviceId) headers["X-Device-Id"] = deviceId;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body, headers: res.headers, timedOut: false, networkError: false };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return {
      status: timedOut ? 504 : 502,
      body: null,
      headers: EMPTY_HEADERS,
      timedOut,
      networkError: !timedOut,
    };
  }
}

/** Machine code from the backend's error envelope ({ error: { code } }) or a flat { code }. */
export function backendErrorCode(body: unknown): string | undefined {
  const b = body as { code?: unknown; error?: { code?: unknown } } | null | undefined;
  const code = b?.error?.code ?? b?.code;
  return typeof code === "string" ? code : undefined;
}

/** Extract a human message from a backend error envelope. */
export function backendMessage(body: unknown, fallback: string): string {
  const b = body as
    | { message?: string; error?: { message?: string } }
    | null
    | undefined;
  return b?.message ?? b?.error?.message ?? fallback;
}

/** The backend wraps success bodies as { success, data } — hand the data to the client. */
export function unwrapData(body: unknown): unknown {
  const b = body as { data?: unknown } | null | undefined;
  return b && typeof b === "object" && "data" in b ? b.data : body;
}

/** Uniform BFF error body: { message, code }. */
export function bffError(status: number, message: string, code: string, init?: ResponseInit): NextResponse {
  return NextResponse.json({ message, code }, { ...init, status });
}

/**
 * Turn a backend result into the client response. Success bodies are
 * unwrapped; Retry-After is forwarded; `serverTime` (when the backend sends
 * one) is mirrored into X-Server-Time so the client clock module can sample it
 * from every response uniformly.
 */
export function proxyJson(
  up: BackendResult,
  opts: { unwrap?: boolean; fallbackMessage?: string } = {}
): NextResponse {
  if (up.timedOut) {
    return bffError(504, "The ticket server did not answer in time.", "UPSTREAM_TIMEOUT");
  }
  if (up.networkError) {
    return bffError(502, "The ticket server could not be reached.", "UPSTREAM_UNREACHABLE");
  }

  const retryAfter = up.headers.get("retry-after");
  if (up.status >= 200 && up.status < 300) {
    const data = opts.unwrap === false ? up.body : unwrapData(up.body);
    const res = NextResponse.json(data ?? {}, { status: 200 });
    const serverTime = (data as { serverTime?: unknown } | null)?.serverTime;
    if (typeof serverTime === "string") res.headers.set("X-Server-Time", serverTime);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }

  const res = bffError(
    up.status,
    backendMessage(up.body, opts.fallbackMessage ?? "Request failed"),
    backendErrorCode(up.body) ?? `HTTP_${up.status}`
  );
  if (retryAfter) res.headers.set("Retry-After", retryAfter);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
