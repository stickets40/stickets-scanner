import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { base64urlDecode, base64urlEncode, sha256Hex, ticketHash } from "@/lib/hash";

describe("hash helpers", () => {
  it("sha256Hex matches a known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("base64url round-trips and matches Node for every length mod 3", () => {
    for (const len of [0, 1, 2, 3, 16, 31, 32, 33, 64]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
      const enc = base64urlEncode(bytes);
      expect(enc).toBe(Buffer.from(bytes).toString("base64url"));
      expect(Array.from(base64urlDecode(enc)!)).toEqual(Array.from(bytes));
    }
    expect(base64urlDecode("not*valid")).toBeNull();
  });
  it("ticketHash is the backend's manifestHash: base64url(sha256(tokenId))[0..16 bytes] → 22 chars", () => {
    const token = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    const expected = createHash("sha256").update(token, "utf8").digest().subarray(0, 16).toString("base64url");
    expect(ticketHash(token)).toBe(expected);
    expect(ticketHash(token)).toHaveLength(22);
  });
});
