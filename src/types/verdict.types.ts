import { z } from "zod";

/**
 * Scan verdicts — the SERVER union (mirrors stickets-backend
 * src/modules/scanner/scanner.types.ts, parsed strictly at the fetch boundary
 * so contract drift fails loudly) plus the client-only kinds the offline engine
 * and the network layer produce. The result screen renders `Verdict`.
 */

// ---------- server verdicts ----------
const seatInfoSchema = z.object({ section: z.number() }).nullable();
const verdictBase = {
  serverTime: z.string(),
  /** The scanId was already processed: this is the ORIGINAL answer, replayed. */
  replayed: z.literal(true).optional(),
};

export const serverSuccessSchema = z.object({
  result: z.literal("success"),
  scanLogId: z.string(),
  undoableUntil: z.string(),
  ticket: z.object({
    ownerName: z.string(),
    ticketTypeName: z.string(),
    ticketTypeId: z.number(),
    nftId: z.string(),
    tokenId: z.string(),
    seatInfo: seatInfoSchema,
  }),
  admittedCount: z.number().optional(),
  totalTickets: z.number().optional(),
  ...verdictBase,
});

export const serverAlreadyUsedSchema = z.object({
  result: z.literal("already_used"),
  ticket: z.object({
    ownerName: z.string(),
    seatInfo: seatInfoSchema,
    firstUsedAt: z.string(),
    ticketTypeName: z.string().optional(),
    tokenId: z.string(),
  }),
  firstScannedBy: z
    .object({ scannerId: z.string(), scannerName: z.string(), deviceId: z.string().nullable() })
    .nullable(),
  secondsAgo: z.number().nullable(),
  sameDevice: z.boolean(),
  ...verdictBase,
});

export const serverWrongScannerSchema = z.object({
  result: z.literal("wrong_scanner"),
  correctScannerName: z.string().nullable(),
  correctScannerNames: z.array(z.string()),
  message: z.string(),
  ticketTypeId: z.number(),
  ...verdictBase,
});

export const INVALID_CODES = [
  "NOT_A_TICKET",
  "UNKNOWN_TICKET",
  "WRONG_EVENT",
  "BAD_SIGNATURE",
  "STALE_QR",
  "ORDER_NOT_SETTLED",
  "TICKET_IN_TRANSFER",
  "EVENT_INACTIVE",
  "LEGACY_FORMAT_REJECTED",
] as const;
export type InvalidCode = (typeof INVALID_CODES)[number];

export const serverInvalidSchema = z.object({
  result: z.literal("invalid"),
  // Known codes get tailored copy; an unknown (newer) code still renders "NO".
  code: z.string(),
  message: z.string(),
  ...verdictBase,
});

export const serverOutsideWindowSchema = z.object({
  result: z.literal("outside_window"),
  reason: z.enum(["too_early", "too_late"]),
  opensAt: z.string(),
  closesAt: z.string(),
  ticket: z.object({ ownerName: z.string(), ticketTypeName: z.string(), tokenId: z.string() }).optional(),
  ...verdictBase,
});

export const serverVerdictSchema = z.discriminatedUnion("result", [
  serverSuccessSchema,
  serverAlreadyUsedSchema,
  serverWrongScannerSchema,
  serverInvalidSchema,
  serverOutsideWindowSchema,
]);
export type ServerVerdict = z.infer<typeof serverVerdictSchema>;
export type ServerSuccess = z.infer<typeof serverSuccessSchema>;
export type ServerAlreadyUsed = z.infer<typeof serverAlreadyUsedSchema>;
export type ServerWrongScanner = z.infer<typeof serverWrongScannerSchema>;
export type ServerInvalid = z.infer<typeof serverInvalidSchema>;
export type ServerOutsideWindow = z.infer<typeof serverOutsideWindowSchema>;
export type ServerResultKind = ServerVerdict["result"];

/** Parse a raw server verdict; throws (caught by the caller) on drift. */
export function parseServerVerdict(raw: unknown): ServerVerdict {
  return serverVerdictSchema.parse(raw);
}

export const undoResultSchema = z.object({
  result: z.literal("undone"),
  scanLogId: z.string(),
  tokenId: z.string(),
  serverTime: z.string(),
  replayed: z.literal(true).optional(),
});
export type UndoResult = z.infer<typeof undoResultSchema>;

export const batchResultItemSchema = z.union([
  z.object({ scanId: z.string(), verdict: serverVerdictSchema }),
  z.object({ scanId: z.string(), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export const batchResponseSchema = z.object({
  results: z.array(batchResultItemSchema),
  serverTime: z.string(),
});
export type BatchResultItem = z.infer<typeof batchResultItemSchema>;

export const attendeeMatchSchema = z.object({
  tokenId: z.string(),
  ownerName: z.string(),
  emailMasked: z.string().nullable(),
  ticketTypeId: z.number(),
  ticketTypeName: z.string(),
  status: z.string(),
  scannableHere: z.boolean(),
});
export const attendeesResponseSchema = z.object({
  items: z.array(attendeeMatchSchema),
  serverTime: z.string(),
});
export type AttendeeMatch = z.infer<typeof attendeeMatchSchema>;

export const liveStatsSchema = z.object({
  admitted: z.number(),
  totalTickets: z.number(),
  byTicketType: z.array(z.object({ id: z.number(), name: z.string(), admitted: z.number(), total: z.number() })),
  serverTime: z.string(),
});
export type LiveStats = z.infer<typeof liveStatsSchema>;

export const manifestTicketSchema = z.object({
  h: z.string().length(22),
  tt: z.number(),
  v: z.number(),
  s: z.enum(["valid", "used"]),
  n: z.string(),
});
export const manifestPageSchema = z.object({
  eventId: z.string(),
  eventName: z.string(),
  generatedAt: z.string(),
  serverTime: z.string(),
  publicKey: z.string(),
  keyAlg: z.literal("ed25519"),
  qrFormat: z.literal("ST3"),
  window: z.object({ opensAt: z.string(), closesAt: z.string() }),
  ticketTypes: z.array(z.object({ id: z.number(), name: z.string(), seated: z.boolean(), sectionNum: z.number().nullable() })),
  allowedTicketTypeIds: z.array(z.number()),
  tickets: z.array(manifestTicketSchema),
  cursor: z.string().nullable(),
  since: z.string().optional(),
});
export type ManifestPage = z.infer<typeof manifestPageSchema>;
export type ManifestTicket = z.infer<typeof manifestTicketSchema>;

// ---------- what the result screen renders ----------
export interface TicketSummary {
  ownerName: string;
  ticketTypeName: string;
  ticketTypeId?: number;
  tokenId?: string;
  seatInfo?: { section: number } | null;
}

export type UnverifiableReason = "legacy_format" | "idb_unavailable" | "no_manifest" | "offline_disabled";

export type Verdict =
  | { kind: "success"; scanId: string; server: ServerSuccess; ticket: TicketSummary }
  | { kind: "success_offline"; scanId: string; ticket: TicketSummary; capturedAt: string; manifestAgeMs: number }
  | { kind: "already_used"; scanId: string; server: ServerAlreadyUsed; ticket: TicketSummary }
  | {
      kind: "already_used_offline";
      scanId: string;
      ticket: TicketSummary;
      sameDevice: boolean;
      usedAt: string | null;
      manifestAgeMs: number;
    }
  | {
      kind: "wrong_scanner";
      scanId: string;
      source: "server" | "offline";
      correctScannerNames: string[];
      message: string | null;
      ticketTypeId: number;
      ticket?: TicketSummary;
    }
  | {
      kind: "outside_window";
      scanId: string;
      source: "server" | "offline";
      reason: "too_early" | "too_late";
      opensAt: string;
      closesAt: string;
      ticket?: TicketSummary;
    }
  | { kind: "invalid"; scanId: string; source: "server" | "offline"; code: string; message: string }
  | {
      kind: "authentic_not_in_manifest";
      scanId: string;
      payload: string;
      hint: { h: string; tokenId: string; eventId: string };
      manifestAgeMs: number;
      canTryOnline: boolean;
    }
  | { kind: "unverifiable"; scanId: string; payload: string; reason: UnverifiableReason; canTryOnline: boolean }
  | { kind: "admitted_unverified"; scanId: string; capturedAt: string }
  | { kind: "unverifiable_denied"; scanId: string }
  | { kind: "error"; scanId: string; message: string; code?: string }
  | { kind: "undone"; scanId: string; tokenId: string };

export type VerdictKind = Verdict["kind"];

/** Kinds that need the operator to choose before the scan is complete. */
export const CHOICE_KINDS: ReadonlySet<VerdictKind> = new Set(["authentic_not_in_manifest", "unverifiable"]);

export const INVALID_MESSAGES: Record<InvalidCode, string> = {
  NOT_A_TICKET: "Not a Stickets ticket",
  UNKNOWN_TICKET: "Ticket not found",
  WRONG_EVENT: "Ticket is for a different event",
  BAD_SIGNATURE: "Invalid QR code",
  STALE_QR: "QR code replaced — ask them to refresh their ticket",
  ORDER_NOT_SETTLED: "Ticket purchase not completed",
  TICKET_IN_TRANSFER: "Ticket is being transferred",
  EVENT_INACTIVE: "Event is not open for scanning",
  LEGACY_FORMAT_REJECTED: "Outdated QR — ask them to refresh their ticket",
};

export function invalidMessage(code: string, fallback?: string): string {
  return (INVALID_MESSAGES as Record<string, string>)[code] ?? fallback ?? "Invalid ticket";
}
