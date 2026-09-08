import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as scan } from "@/app/api/scan/route";
import { POST as batch } from "@/app/api/scan/batch/route";
import { GET as attendees } from "@/app/api/attendees/route";
import { GET as health } from "@/app/api/health/route";
import { POST as telemetry } from "@/app/api/telemetry/route";
import { scrubTelemetry } from "@/app/api/_lib/telemetry";
import { POST as accessCode } from "@/app/api/auth/access-code/route";

const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 20 * 3600 })).toString("base64url")}.s`;
const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const authed = (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(url, { ...init, headers: { cookie: `scanner-token=${jwt()}`, "content-type": "application/json", ...(init.headers ?? {}) } });
// Control characters expressed as escapes so the test source itself stays printable.
const CONTROL_ONLY = String.fromCharCode(1, 2, 31);

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.SCANNER_BACKEND_URL = "http://backend.test/api/scanner";
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("POST /api/scan", () => {
  it("validates the body (400 BAD_REQUEST, never forwarded)", async () => {
    const res = await scan(authed("http://s/api/scan", { method: "POST", body: JSON.stringify({ payload: "x", scanId: "not-a-uuid" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("forwards a valid scan with the device id and unwraps the verdict", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { result: "invalid", code: "NOT_A_TICKET", message: "m", serverTime: "2026-09-05T18:00:00.000Z" } }));
    const scanId = crypto.randomUUID();
    const res = await scan(
      authed("http://s/api/scan", { method: "POST", headers: { "x-device-id": "dev-1" }, body: JSON.stringify({ payload: "ST3.x", scanId, source: "live" }) })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "invalid", code: "NOT_A_TICKET" });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://backend.test/api/scanner/scan");
    expect(JSON.parse(init.body as string)).toMatchObject({ payload: "ST3.x", scanId, deviceId: "dev-1", source: "live" });
  });
  it("a backend timeout is a 504 the client can fall back on", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }));
    const res = await scan(authed("http://s/api/scan", { method: "POST", body: JSON.stringify({ payload: "ST3.x", scanId: crypto.randomUUID() }) }));
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  });
});

describe("POST /api/scan/batch", () => {
  it("refuses more than 50 items and an empty batch", async () => {
    const scans = Array.from({ length: 51 }, () => ({ payload: "p", scanId: crypto.randomUUID() }));
    expect((await batch(authed("http://s/api/scan/batch", { method: "POST", body: JSON.stringify({ scans }) }))).status).toBe(400);
    expect((await batch(authed("http://s/api/scan/batch", { method: "POST", body: JSON.stringify({ scans: [] }) }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("forwards a batch and unwraps results", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { results: [], serverTime: "2026-09-05T18:00:00.000Z" } }));
    const res = await batch(authed("http://s/api/scan/batch", { method: "POST", body: JSON.stringify({ scans: [{ payload: "p", scanId: crypto.randomUUID(), capturedAt: "2026-09-05T18:00:00.000Z" }] }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ results: [] });
  });
});

describe("GET /api/attendees", () => {
  it("strips control characters before validating and forwards the cleaned q", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { items: [], serverTime: "x" } }));
    const res = await attendees(authed("http://s/api/attendees?q=" + encodeURIComponent("ni no\n")));
    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get("q")).toBe("ni no");
  });
  it("rejects a query that is empty or too short after cleaning", async () => {
    expect((await attendees(authed("http://s/api/attendees?q=" + encodeURIComponent(CONTROL_ONLY)))).status).toBe(400);
    expect((await attendees(authed("http://s/api/attendees?q=a"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/health", () => {
  it("answers without auth, reports upstream and stamps X-Server-Time", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, upstream: "ok" });
    expect(res.headers.get("x-server-time")).toBeTruthy();
    expect((fetchMock.mock.calls[0][0] as string).toString()).toBe("http://backend.test/health");
  });
});

describe("POST /api/telemetry", () => {
  it("caps the body and scrubs QR payloads / credentials", async () => {
    const big = new NextRequest("http://s/api/telemetry", { method: "POST", body: JSON.stringify({ x: "y".repeat(9000) }) });
    expect((await telemetry(big)).status).toBe(413);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = new NextRequest("http://s/api/telemetry", { method: "POST", body: JSON.stringify({ type: "camera_error", data: { payload: "ST3.secret", accessCode: "1234", kind: "in-use" } }) });
    expect((await telemetry(ok)).status).toBe(204);
    expect(warn.mock.calls[0][1]).not.toContain("ST3.secret");
    expect(warn.mock.calls[0][1]).toContain("in-use");
    warn.mockRestore();
    expect(scrubTelemetry({ a: { payload: "p", token: "t", keep: 1 } })).toEqual({ a: { keep: 1 } });
  });
});

describe("POST /api/auth/access-code", () => {
  it("sets both cookies and returns profile + expiry + device (never the token)", async () => {
    const token = jwt();
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: { accessToken: token, expiresAt: "2026-09-06T18:00:00.000Z", deviceId: "dev-1", scanner: { scannerId: "s1", name: "Gate A", eventId: "1", eventName: "Fest", allowedTicketTypeIds: [] } },
      })
    );
    const res = await accessCode(new NextRequest("http://s/api/auth/access-code", { method: "POST", body: JSON.stringify({ accessCode: "1234-5678", deviceId: "dev-1" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ scanner: { name: "Gate A" }, expiresAt: "2026-09-06T18:00:00.000Z", deviceId: "dev-1" });
    expect(JSON.stringify(body)).not.toContain(token);
    expect(res.cookies.get("scanner-token")?.value).toBe(token);
    expect(res.cookies.get("scanner-session-hint")?.value).toBe("1");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ accessCode: "1234-5678", deviceId: "dev-1" });
  });
  it("passes the backend's rejection code through", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { success: false, error: { message: "Invalid access code", code: "INVALID_ACCESS_CODE" } }));
    const res = await accessCode(new NextRequest("http://s/api/auth/access-code", { method: "POST", body: JSON.stringify({ accessCode: "0000-0000" }) }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Invalid access code", code: "INVALID_ACCESS_CODE" });
    expect(res.cookies.get("scanner-token")).toBeUndefined();
  });
});
