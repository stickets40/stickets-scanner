import { sha256 } from "@noble/hashes/sha2";

/** Synchronous hashing — the scan pipeline must not yield between detection and dedupe. */
export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  return sha256(typeof input === "string" ? new TextEncoder().encode(input) : input);
}

export function sha256Hex(input: string | Uint8Array): string {
  return Array.from(sha256Bytes(input))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "" : B64[c & 63];
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64urlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const std = text.replace(/-/g, "+").replace(/_/g, "/");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of std) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/**
 * The manifest key for a ticket: base64url(sha256(tokenId)) truncated to the
 * first 16 bytes → 22 chars. MUST match the backend's manifestHash.
 */
export function ticketHash(tokenId: string): string {
  return base64urlEncode(sha256Bytes(tokenId).subarray(0, 16));
}
