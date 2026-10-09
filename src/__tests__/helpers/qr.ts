import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { base64urlEncode, ticketHash } from "@/lib/hash";
import type { ManifestPage } from "@/types/verdict.types";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export const TOKEN = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
export const TOKEN_2 = "8xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
export const TOKEN_3 = "9xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

export function makeKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return { priv, pub, pubB64: base64urlEncode(pub) };
}

export function makeV3Qr(opts: { eventId: string; tokenId: string; qrv: number; priv: Uint8Array }): string {
  const msg = `ST3.${opts.eventId}.${opts.tokenId}.${opts.qrv}`;
  const sig = ed.sign(new TextEncoder().encode(msg), opts.priv);
  return `${msg}.${base64urlEncode(sig)}`;
}

export function makePage(
  over: Partial<ManifestPage> & { pubB64: string; tickets?: ManifestPage["tickets"] }
): ManifestPage {
  const { pubB64, ...rest } = over;
  return {
    eventId: "42",
    eventName: "Show",
    generatedAt: "2026-09-05T18:00:00.000Z",
    serverTime: "2026-09-05T18:00:00.000Z",
    publicKey: pubB64,
    keyAlg: "ed25519",
    qrFormat: "ST3",
    window: { opensAt: "2026-09-05T15:00:00.000Z", closesAt: "2026-09-06T00:00:00.000Z" },
    ticketTypes: [
      { id: 1, name: "GA", seated: false, sectionNum: null },
      { id: 2, name: "VIP", seated: true, sectionNum: 4 },
    ],
    allowedTicketTypeIds: [],
    tickets: [],
    cursor: null,
    ...rest,
  };
}

export const row = (tokenId: string, tt = 1, v = 1, s: "valid" | "used" = "valid", n = "Alice") => ({
  h: ticketHash(tokenId),
  tt,
  v,
  s,
  n,
});
