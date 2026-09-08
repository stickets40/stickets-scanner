import { z } from "zod";

/**
 * Scanner identity + device preferences. Scan verdict shapes live in
 * verdict.types.ts (re-exported here so older imports keep resolving).
 */
export const scannerInfoSchema = z.object({
  scannerId: z.string(),
  name: z.string(),
  eventId: z.string(),
  eventName: z.string(),
  allowedTicketTypeIds: z.array(z.number()),
});
export type ScannerInfo = z.infer<typeof scannerInfoSchema>;

/** What the scanner's own /api/auth/* routes return to the client (no token). */
export const loginResultSchema = z.object({
  scanner: scannerInfoSchema,
  expiresAt: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
});
export type LoginResult = z.infer<typeof loginResultSchema>;

export type ScanMode = "confirm" | "fast";
export type AccessMethod = "account" | "access_code";
export const DEFAULT_SCAN_MODE: ScanMode = "fast";

/** How long a successful verdict stays up in `fast` mode. */
export const FAST_MODE_DWELL_MS = 1100;

export {
  parseServerVerdict,
  serverVerdictSchema,
  type ServerVerdict,
  type Verdict,
  type VerdictKind,
} from "./verdict.types";
