import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyJson, publicOrigin, type BackendResult } from "@/app/api/_lib/backend";
import { decodeJwtExpMs, setSessionCookies, withScannerAuth } from "@/app/api/_lib/session";

const jwt = (expSecondsFromNow: number) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow, deviceId: "d1" })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
};

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("backendFetch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.SCANNER_BACKEND_URL = "http://backend.test/api/scanner";
    process.env.INTERNAL_API_KEY = "internal-key";
    process.env.SCANNER_PUBLIC_ORIGIN = "https://scanner.stickets.test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends the trust headers the backend needs: Origin, X-Internal-Key, forwarded client IP, device id, bearer", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { ok: 1 } }));
    const req = new NextRequest("https://scanner.stickets.test/api/scan", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-device-id": "dev-1" },
    });
    const res = await backendFetch("POST", "scan", { req, token: "tok", body: { a: 1 } });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://backend.test/api/scanner/scan");
    const h = init.headers as Record<string, string>;
    expect(h.Origin).toBe("https://scanner.stickets.test");
    expect(h["X-Internal-Key"]).toBe("internal-key");
    expect(h["X-Client-IP"]).toBe("203.0.113.9");
    expect(h["X-Device-Id"]).toBe("dev-1");
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["X-Request-Id"]).toMatch(/[0-9a-f-]{36}/);
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("puts search params on GETs and never sends a body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await backendFetch("GET", "attendees", { search: { q: "nino", cursor: undefined } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://backend.test/api/scanner/attendees?q=nino");
    expect(init.body).toBeUndefined();
  });

  it("a timeout becomes 504/timedOut, a network failure 502/networkError — never a throw", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    expect(await backendFetch("GET", "x")).toMatchObject({ status: 504, timedOut: true, networkError: false });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await backendFetch("GET", "x")).toMatchObject({ status: 502, timedOut: false, networkError: true });
  });

  it("publicOrigin falls back to the forwarded host", () => {
    delete process.env.SCANNER_PUBLIC_ORIGIN;
    const req = new NextRequest("http://internal/api/x", { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "scan.example.com" } });
    expect(publicOrigin(req)).toBe("https://scan.example.com");
  });
});

describe("proxyJson", () => {
  const up = (over: Partial<BackendResult>): BackendResult => ({ status: 200, body: null, headers: new Headers(), timedOut: false, networkError: false, ...over });

  it("unwraps { success, data } and mirrors serverTime into X-Server-Time", async () => {
    const res = proxyJson(up({ body: { success: true, data: { result: "invalid", serverTime: "2026-09-05T18:00:00.000Z" } } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "invalid", serverTime: "2026-09-05T18:00:00.000Z" });
    expect(res.headers.get("x-server-time")).toBe("2026-09-05T18:00:00.000Z");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("maps the backend error envelope to { message, code } and forwards Retry-After", async () => {
    const res = proxyJson(up({ status: 429, body: { success: false, error: { message: "slow down", code: "RATE_LIMITED" } }, headers: new Headers({ "retry-after": "30" }) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ message: "slow down", code: "RATE_LIMITED" });
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("transport failures get their own codes", async () => {
    expect(await proxyJson(up({ status: 504, timedOut: true })).json()).toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    expect(await proxyJson(up({ status: 502, networkError: true })).json()).toMatchObject({ code: "UPSTREAM_UNREACHABLE" });
  });
});

describe("session", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.SCANNER_BACKEND_URL = "http://backend.test/api/scanner";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("decodeJwtExpMs reads exp without verifying, null for junk", () => {
    const t = jwt(3600);
    expect(Math.abs(decodeJwtExpMs(t)! - (Date.now() + 3_600_000))).toBeLessThan(2000);
    expect(decodeJwtExpMs("nope")).toBeNull();
    expect(decodeJwtExpMs("a.b.c")).toBeNull();
  });

  it("setSessionCookies sizes the token cookie from exp and sets the long-lived hint", () => {
    const res = NextResponse.json({});
    setSessionCookies(res, jwt(7200));
    const token = res.cookies.get("scanner-token");
    const hint = res.cookies.get("scanner-session-hint");
    expect(token?.httpOnly).toBe(true);
    expect(token?.maxAge).toBeGreaterThan(7000);
    expect(token?.maxAge).toBeLessThanOrEqual(7200);
    expect(hint?.httpOnly).toBe(false);
    expect(hint?.maxAge).toBe(30 * 86400);
  });

  it("withScannerAuth: no cookie → 401 NO_SESSION without touching the backend", async () => {
    const handler = vi.fn();
    const res = await withScannerAuth(handler)(new NextRequest("http://s/api/scan", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "NO_SESSION" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("withScannerAuth: an upstream 401 passes the backend code through and clears the token cookie but keeps the hint", async () => {
    const res = await withScannerAuth(async () => NextResponse.json({ message: "expired", code: "SCANNER_TOKEN_EXPIRED" }, { status: 401 }))(
      new NextRequest("http://s/api/scan", { method: "POST", headers: { cookie: `scanner-token=${jwt(3600)}; scanner-session-hint=1` } })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "SCANNER_TOKEN_EXPIRED" });
    expect(res.cookies.get("scanner-token")?.maxAge).toBe(0);
    expect(res.cookies.get("scanner-session-hint")).toBeUndefined();
  });

  it("withScannerAuth: a 2xx with a token near expiry renews it silently and reports the new expiry", async () => {
    const fresh = jwt(24 * 3600);
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { accessToken: fresh, expiresAt: "2026-09-06T18:00:00.000Z" } }));
    const res = await withScannerAuth(async () => NextResponse.json({ ok: true }))(
      new NextRequest("http://s/api/stats/live", { headers: { cookie: `scanner-token=${jwt(3600)}` } })
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][0] as URL).toString()).toBe("http://backend.test/api/scanner/auth/refresh");
    expect(res.cookies.get("scanner-token")?.value).toBe(fresh);
    expect(res.headers.get("x-session-renewal")).toBe("1");
    expect(res.headers.get("x-session-expires-at")).toBe("2026-09-06T18:00:00.000Z");
  });

  it("withScannerAuth: a token with plenty of life left is not refreshed", async () => {
    const res = await withScannerAuth(async () => NextResponse.json({ ok: true }))(
      new NextRequest("http://s/api/stats/live", { headers: { cookie: `scanner-token=${jwt(20 * 3600)}` } })
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get("x-session-renewal")).toBeNull();
    expect(res.headers.get("x-session-expires-at")).toBeTruthy();
  });
});
