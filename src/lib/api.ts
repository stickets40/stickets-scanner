import { getDeviceId } from "@/lib/device-id";
import { recordServerTime } from "@/lib/clock";
import { getConnectivityMonitor } from "@/lib/connectivity";
import { notifyAuthRequired } from "@/lib/events";
import { useSessionStore } from "@/stores/session.store";

/**
 * Client HTTP layer. Calls the scanner's OWN same-origin BFF routes (/api/*),
 * never the backend directly — the scanner JWT is an httpOnly cookie the
 * browser attaches automatically, so no token is ever handled in client JS.
 *
 * Never throws for HTTP outcomes: callers get { status, data, code, message }
 * and decide. Every response feeds the corrected clock (X-Server-Time), the
 * session state (X-Session-Expires-At / -Renewal) and the connectivity
 * estimate. A 401 flips the session to `reauth_required` and NOTHING here
 * redirects — the re-auth sheet renders inline over a still-working scanner.
 */
export interface ApiResult<T = unknown> {
  status: number;
  ok: boolean;
  data: T | null;
  code?: string;
  message?: string;
  retryAfterSec?: number;
  timedOut: boolean;
  networkError: boolean;
}

export interface RequestOptions {
  json?: unknown;
  searchParams?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  /** Do not count a failure against connectivity (e.g. the probe itself). */
  untracked?: boolean;
}

export const DEFAULT_TIMEOUT_MS = 8000;

const AUTH_CODES_NEEDING_REAUTH = new Set([
  "NO_SESSION",
  "SCANNER_TOKEN_MISSING",
  "SCANNER_TOKEN_INVALID",
  "SCANNER_TOKEN_EXPIRED",
  "SCANNER_TOKEN_REVOKED",
  "SCANNER_INACTIVE",
  "SCANNER_EVENT_MISSING",
  "EVENT_OVER",
]);

export function handleAuthFailure(code: string | undefined): void {
  const resolved = code && AUTH_CODES_NEEDING_REAUTH.has(code) ? code : "SCANNER_TOKEN_INVALID";
  const store = useSessionStore.getState();
  if (store.auth !== "reauth_required") {
    store.setAuth("reauth_required", resolved);
    notifyAuthRequired(resolved);
  }
}

function readSessionHeaders(res: Response): void {
  const exp = res.headers.get("x-session-expires-at");
  const store = useSessionStore.getState();
  if (exp) store.setExpiresAt(exp);
  if (res.headers.get("x-session-renewal") === "1") store.setRenewalFailed(false);
}

export async function request<T = unknown>(method: "GET" | "POST", path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const url = new URL(`/api/${path.replace(/^\/+/, "")}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.searchParams ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json", "X-Device-Id": getDeviceId() };
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";
  const startedAt = Date.now();
  const monitor = getConnectivityMonitor();

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    if (!opts.untracked) monitor.dispatch({ type: "REQUEST_FAIL" });
    return { status: 0, ok: false, data: null, timedOut, networkError: !timedOut, message: timedOut ? "Timed out" : "Network error" };
  }

  const endedAt = Date.now();
  const serverTime = res.headers.get("x-server-time");
  if (serverTime) recordServerTime(serverTime, { startedAt, endedAt });
  readSessionHeaders(res);

  const data = (await res.json().catch(() => null)) as T | null;
  const body = data as { code?: string; message?: string } | null;
  const retryAfter = Number(res.headers.get("retry-after"));

  if (!opts.untracked) {
    // A 4xx is a HEALTHY network; only transport-class failures degrade it.
    if (res.status >= 500 || res.status === 0) monitor.dispatch({ type: "REQUEST_FAIL" });
    else monitor.dispatch({ type: "REQUEST_OK" });
    if (res.status === 429) monitor.dispatch({ type: "RATE_LIMITED", until: Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30) * 1000 });
  }
  if (res.status === 401) handleAuthFailure(body?.code);
  if (res.ok) useSessionStore.getState().setAuth("authenticated");

  return {
    status: res.status,
    ok: res.ok,
    data,
    code: body?.code,
    message: body?.message,
    retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    timedOut: false,
    networkError: false,
  };
}

export const api = {
  get: <T = unknown>(path: string, opts?: RequestOptions) => request<T>("GET", path, opts),
  post: <T = unknown>(path: string, json?: unknown, opts?: Omit<RequestOptions, "json">) => request<T>("POST", path, { ...opts, json: json ?? {} }),
};

/** Human message for a failed ApiResult. */
export function describeFailure(r: ApiResult, fallback = "Something went wrong."): string {
  if (r.timedOut) return "The server took too long to answer.";
  if (r.networkError) return typeof navigator !== "undefined" && !navigator.onLine ? "You're offline." : "Couldn't reach the server.";
  return r.message ?? fallback;
}
