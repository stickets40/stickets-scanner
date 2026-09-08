import { describe, expect, it } from "vitest";
import { batchResponseSchema, manifestPageSchema, parseServerVerdict } from "@/types/verdict.types";
import { loginResultSchema, scannerInfoSchema } from "@/types/scanner.types";
import { makePage } from "./helpers/qr";

const base = { serverTime: "2026-09-05T18:00:00.000Z" };

describe("server verdict contract (Phase 2 union)", () => {
  it("parses every kind", () => {
    expect(
      parseServerVerdict({
        result: "success",
        scanLogId: "log-1",
        undoableUntil: "2026-09-05T18:05:00.000Z",
        ticket: { ownerName: "Alice", ticketTypeName: "GA", ticketTypeId: 1, nftId: "t", tokenId: "t", seatInfo: null },
        ...base,
      }).result
    ).toBe("success");
    expect(
      parseServerVerdict({
        result: "already_used",
        ticket: { ownerName: "Bob", seatInfo: { section: 3 }, firstUsedAt: "2026-09-05T17:00:00.000Z", tokenId: "t" },
        firstScannedBy: { scannerId: "s2", scannerName: "Gate B", deviceId: "d9" },
        secondsAgo: 40,
        sameDevice: false,
        replayed: true,
        ...base,
      })
    ).toMatchObject({ result: "already_used", replayed: true });
    expect(
      parseServerVerdict({ result: "wrong_scanner", correctScannerName: "Gate B", correctScannerNames: ["Gate B", "Gate C"], message: "m", ticketTypeId: 2, ...base }).result
    ).toBe("wrong_scanner");
    expect(parseServerVerdict({ result: "invalid", code: "STALE_QR", message: "m", ...base }).result).toBe("invalid");
    expect(
      parseServerVerdict({ result: "outside_window", reason: "too_early", opensAt: base.serverTime, closesAt: base.serverTime, ...base }).result
    ).toBe("outside_window");
  });

  it("rejects an unknown result kind and the old flat shape", () => {
    expect(() => parseServerVerdict({ result: "maybe", ...base })).toThrow();
    expect(() => parseServerVerdict({ result: "success", ownerName: "Alice", ...base })).toThrow();
    expect(() => parseServerVerdict({ result: "success", ticket: {}, ...base })).toThrow();
  });

  it("batch results echo scanId and allow per-item errors", () => {
    const parsed = batchResponseSchema.parse({
      results: [
        { scanId: "a", verdict: { result: "invalid", code: "NOT_A_TICKET", message: "m", ...base } },
        { scanId: "b", error: { code: "SCAN_ERROR", message: "db" } },
      ],
      ...base,
    });
    expect(parsed.results).toHaveLength(2);
  });

  it("manifest page shape (22-char hashes)", () => {
    expect(() => manifestPageSchema.parse(makePage({ pubB64: "k", tickets: [{ h: "short", tt: 1, v: 1, s: "valid", n: "x" }] }))).toThrow();
    expect(manifestPageSchema.parse(makePage({ pubB64: "k" })).qrFormat).toBe("ST3");
  });
});

describe("login contract", () => {
  it("parses the BFF login result with expiry + device", () => {
    const res = loginResultSchema.parse({
      scanner: { scannerId: "s1", name: "Gate A", eventId: "1", eventName: "Summer Fest", allowedTicketTypeIds: [] },
      expiresAt: "2026-09-06T18:00:00.000Z",
      deviceId: "dev-1",
    });
    expect(res.scanner.scannerId).toBe("s1");
  });
  it("REJECTS the old scannerName-based shape", () => {
    expect(() => scannerInfoSchema.parse({ scannerId: "s1", scannerName: "Gate A", eventId: "1", allowedTicketTypeIds: [] })).toThrow();
  });
});
