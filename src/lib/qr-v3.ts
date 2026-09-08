import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { base64urlDecode, ticketHash } from "@/lib/hash";

// @noble/ed25519 v2 needs a sync SHA-512 for the sync verify path.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export const QR_V3_REGEX =
  /^ST3\.(\d{1,19})\.([1-9A-HJ-NP-Za-km-z]{32,44})\.(\d{1,9})\.([A-Za-z0-9_-]{86})$/;

export type ParsedQr =
  | {
      kind: "v3";
      eventId: string;
      tokenId: string;
      qrv: number;
      sigB64: string;
      /** The bytes the signature covers: "ST3.<eventId>.<tokenId>.<qrv>". */
      signedMessage: string;
      /** Manifest key. */
      h: string;
    }
  | { kind: "legacy_v2" }
  | { kind: "not_a_ticket" };

/**
 * Classify a scanned string WITHOUT verifying it. v2 (AES-GCM blob, base64
 * with a 12-byte IV) cannot be validated on a device — it is flagged so the
 * engine can route it online or mark it unverifiable.
 */
export function parseQr(raw: string): ParsedQr {
  const text = raw.trim();
  if (!text || text.length > 512) return { kind: "not_a_ticket" };
  if (text.startsWith("ST3.")) {
    const m = QR_V3_REGEX.exec(text);
    if (!m) return { kind: "not_a_ticket" };
    const [, eventId, tokenId, qrv, sigB64] = m;
    return {
      kind: "v3",
      eventId,
      tokenId,
      qrv: Number(qrv),
      sigB64,
      signedMessage: `ST3.${eventId}.${tokenId}.${qrv}`,
      h: ticketHash(tokenId),
    };
  }
  // v2 = base64 of iv(12) + ciphertext + tag(16): ≥ 40 bytes → ≥ 56 chars, standard base64.
  if (/^[A-Za-z0-9+/]+=*$/.test(text) && text.length >= 56 && text.length <= 512) {
    return { kind: "legacy_v2" };
  }
  return { kind: "not_a_ticket" };
}

/** Verify a v3 code against the event's raw 32-byte public key (base64url). Never throws. */
export function verifyV3(parsed: Extract<ParsedQr, { kind: "v3" }>, publicKeyB64url: string): boolean {
  try {
    const key = base64urlDecode(publicKeyB64url);
    const sig = base64urlDecode(parsed.sigB64);
    if (!key || key.length !== 32 || !sig || sig.length !== 64) return false;
    return ed.verify(sig, new TextEncoder().encode(parsed.signedMessage), key);
  } catch {
    return false;
  }
}
