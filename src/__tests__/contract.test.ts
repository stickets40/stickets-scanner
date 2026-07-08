import { describe, it, expect } from "vitest";
import {
  parseScanServerResult,
  scannerInfoSchema,
  loginResultSchema,
} from "@/types/scanner.types";

/**
 * Contract tests — parse representative REAL backend payloads through the zod
 * schemas. These would have caught the drift (flat vs nested, firstUsedAt vs
 * firstScannedAt, name vs scannerName) that broke every scan card. The old flat
 * shapes are asserted to FAIL, proving the runtime guard rejects drift.
 */
describe("scan result contract", () => {
  it("parses a real success payload (nested ticket.*)", () => {
    const r = parseScanServerResult({
      result: "success",
      ticket: {
        ownerName: "Alice",
        ticketTypeName: "General Admission",
        nftId: "42",
        tokenId: "42",
        seatInfo: null,
      },
    });
    expect(r.result).toBe("success");
    if (r.result === "success") {
      expect(r.ticket.ownerName).toBe("Alice");
      expect(r.ticket.seatInfo).toBeNull();
    }
  });

  it("parses already_used with seatInfo + firstUsedAt", () => {
    const r = parseScanServerResult({
      result: "already_used",
      ticket: {
        ownerName: "Bob",
        seatInfo: { section: 3 },
        firstUsedAt: "2026-07-08T10:00:00.000Z",
      },
    });
    expect(r.result).toBe("already_used");
    if (r.result === "already_used") {
      expect(r.ticket.firstUsedAt).toContain("2026");
      expect(r.ticket.seatInfo?.section).toBe(3);
    }
  });

  it("parses wrong_scanner with correctScannerName + message", () => {
    const r = parseScanServerResult({
      result: "wrong_scanner",
      correctScannerName: "Gate B",
      message: "Ticket is valid but assigned to a different entrance",
    });
    expect(r.result).toBe("wrong_scanner");
    if (r.result === "wrong_scanner") expect(r.correctScannerName).toBe("Gate B");
  });

  it("parses invalid with message", () => {
    const r = parseScanServerResult({ result: "invalid", message: "Ticket not found" });
    expect(r.result).toBe("invalid");
    if (r.result === "invalid") expect(r.message).toBe("Ticket not found");
  });

  it("REJECTS the old flat success shape (drift guard)", () => {
    expect(() =>
      parseScanServerResult({
        result: "success",
        ownerName: "Alice",
        ticketTypeName: "GA",
        section: 1,
      })
    ).toThrow();
  });

  it("REJECTS an unknown result kind", () => {
    expect(() => parseScanServerResult({ result: "maybe" })).toThrow();
  });
});

describe("login contract", () => {
  it("parses the backend scanner profile (name/eventName)", () => {
    const scanner = scannerInfoSchema.parse({
      scannerId: "s1",
      name: "Gate A",
      eventId: "1",
      eventName: "Summer Fest",
      allowedTicketTypeIds: [1, 2],
    });
    expect(scanner.name).toBe("Gate A");
    expect(scanner.eventName).toBe("Summer Fest");
  });

  it("parses the BFF login result envelope { scanner }", () => {
    const res = loginResultSchema.parse({
      scanner: {
        scannerId: "s1",
        name: "Gate A",
        eventId: "1",
        eventName: "Summer Fest",
        allowedTicketTypeIds: [],
      },
    });
    expect(res.scanner.scannerId).toBe("s1");
  });

  it("REJECTS the old scannerName-based shape", () => {
    expect(() =>
      scannerInfoSchema.parse({
        scannerId: "s1",
        scannerName: "Gate A",
        eventId: "1",
        allowedTicketTypeIds: [],
      })
    ).toThrow();
  });
});
