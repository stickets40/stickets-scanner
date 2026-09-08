import { describe, expect, it } from "vitest";
import { parseQr, verifyV3 } from "@/lib/qr-v3";
import { ticketHash } from "@/lib/hash";
import { makeKeypair, makeV3Qr, TOKEN } from "./helpers/qr";

describe("qr-v3", () => {
  const kp = makeKeypair();
  const code = makeV3Qr({ eventId: "42", tokenId: TOKEN, qrv: 3, priv: kp.priv });

  it("parses a v3 code into its parts and manifest hash", () => {
    const parsed = parseQr(code);
    expect(parsed).toMatchObject({ kind: "v3", eventId: "42", tokenId: TOKEN, qrv: 3, signedMessage: `ST3.42.${TOKEN}.3`, h: ticketHash(TOKEN) });
  });

  it("verifies against the right key and refuses tampering or another key", () => {
    const parsed = parseQr(code);
    if (parsed.kind !== "v3") throw new Error("unreachable");
    expect(verifyV3(parsed, kp.pubB64)).toBe(true);
    expect(verifyV3(parsed, makeKeypair().pubB64)).toBe(false);

    const bumped = parseQr(code.replace(`.${TOKEN}.3.`, `.${TOKEN}.4.`));
    if (bumped.kind !== "v3") throw new Error("unreachable");
    expect(verifyV3(bumped, kp.pubB64)).toBe(false);

    const otherEvent = parseQr(code.replace("ST3.42.", "ST3.43."));
    if (otherEvent.kind !== "v3") throw new Error("unreachable");
    expect(verifyV3(otherEvent, kp.pubB64)).toBe(false);

    expect(verifyV3(parsed, "AAAA")).toBe(false); // bad key length never throws
  });

  it("classifies legacy v2 blobs and everything else", () => {
    const v2 = Buffer.alloc(80, 7).toString("base64");
    expect(parseQr(v2)).toEqual({ kind: "legacy_v2" });
    expect(parseQr("")).toEqual({ kind: "not_a_ticket" });
    expect(parseQr("WIFI:S:cafe;;")).toEqual({ kind: "not_a_ticket" });
    expect(parseQr("https://example.com/t/1")).toEqual({ kind: "not_a_ticket" });
    expect(parseQr("ST3.garbage")).toEqual({ kind: "not_a_ticket" });
    expect(parseQr(`ST3.42.${TOKEN}.1.${"A".repeat(85)}`)).toEqual({ kind: "not_a_ticket" });
    expect(parseQr("x".repeat(600))).toEqual({ kind: "not_a_ticket" });
    expect(parseQr(`  ${code}\n`)).toMatchObject({ kind: "v3" });
  });
});
