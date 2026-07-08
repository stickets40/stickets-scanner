import { z } from "zod";

/**
 * Scanner contract — MIRRORS the backend exactly and is validated at runtime.
 *
 * Source of truth: stickets-backend/src/services/scannerService.ts (scan result
 * shapes) and scannerAuthService.ts (login `scanner` object). These were
 * hand-written and had drifted (flat vs nested, firstScannedAt vs firstUsedAt,
 * reason vs message, scannerName vs name), so every result card rendered
 * `undefined`. The zod schemas below are parsed at the fetch boundary so any
 * future drift fails loudly instead of silently rendering blanks.
 */

// ---------- Scanner identity (login response `scanner` object) ----------
export const scannerInfoSchema = z.object({
  scannerId: z.string(),
  name: z.string(),
  eventId: z.string(),
  eventName: z.string(),
  allowedTicketTypeIds: z.array(z.number()),
});
export type ScannerInfo = z.infer<typeof scannerInfoSchema>;

/** What the scanner's own /api/auth/* routes return to the client (no token). */
export const loginResultSchema = z.object({ scanner: scannerInfoSchema });
export type LoginResult = z.infer<typeof loginResultSchema>;

// ---------- Scan results returned by the backend ----------
const seatInfoSchema = z.object({ section: z.number() }).nullable();

export const scanSuccessSchema = z.object({
  result: z.literal("success"),
  ticket: z.object({
    ownerName: z.string(),
    ticketTypeName: z.string(),
    nftId: z.string(),
    tokenId: z.string(),
    seatInfo: seatInfoSchema,
  }),
});

export const scanAlreadyUsedSchema = z.object({
  result: z.literal("already_used"),
  ticket: z.object({
    ownerName: z.string(),
    seatInfo: seatInfoSchema,
    firstUsedAt: z.string(),
  }),
});

export const scanWrongScannerSchema = z.object({
  result: z.literal("wrong_scanner"),
  correctScannerName: z.string().nullable(),
  message: z.string(),
});

export const scanInvalidSchema = z.object({
  result: z.literal("invalid"),
  message: z.string(),
});

/** The four states the SERVER can return (discriminated on `result`). */
export const scanServerResultSchema = z.discriminatedUnion("result", [
  scanSuccessSchema,
  scanAlreadyUsedSchema,
  scanWrongScannerSchema,
  scanInvalidSchema,
]);
export type ScanServerResult = z.infer<typeof scanServerResultSchema>;

export type ScanSuccessResult = z.infer<typeof scanSuccessSchema>;
export type ScanAlreadyUsedResult = z.infer<typeof scanAlreadyUsedSchema>;
export type ScanWrongScannerResult = z.infer<typeof scanWrongScannerSchema>;
export type ScanInvalidResult = z.infer<typeof scanInvalidSchema>;

// ---------- Client-only result states (network layer, never from the server) ----------
/** Offline / no-network: the scan was queued locally and NOT yet verified. */
export interface ScanQueuedResult {
  result: "queued";
  capturedAt: string;
}
/** A transient error (timeout, 5xx) — distinct from a rejected ticket. */
export interface ScanErrorResult {
  result: "error";
  message: string;
}

/** Everything the result card can render. */
export type ScanResult = ScanServerResult | ScanQueuedResult | ScanErrorResult;
export type ScanResultType = ScanResult["result"];

// ---------- Client-only device preferences ----------
// `scan_mode` was dropped from the backend (migration 1771176988487); it is now
// a pure device preference. `accessMethod` is derived from which login tab the
// operator used, not from the backend.
export type ScanMode = "internal" | "silent" | "automatic";
export type AccessMethod = "account" | "access_code";
export const DEFAULT_SCAN_MODE: ScanMode = "internal";

/** Parse a raw server scan payload; throws (caught by the caller) on drift. */
export function parseScanServerResult(raw: unknown): ScanServerResult {
  return scanServerResultSchema.parse(raw);
}
