import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalUsed,
  ensureManifest,
  getManifestMeta,
  lookupTicket,
  manifestAgeLabel,
  markUsedLocally,
  ManifestSyncError,
  searchManifestByName,
  syncManifestDelta,
  syncManifestFull,
  type ManifestFetchers,
} from "@/lib/manifest";
import { ticketHash } from "@/lib/hash";
import { resetDb } from "./helpers/idb";
import { makeKeypair, makePage, row, TOKEN, TOKEN_2, TOKEN_3 } from "./helpers/qr";

const kp = makeKeypair();

function fetchersFrom(pages: ReturnType<typeof makePage>[], deltas: ReturnType<typeof makePage>[] = []): ManifestFetchers & { calls: { page: number; delta: number } } {
  const calls = { page: 0, delta: 0 };
  return {
    calls,
    fetchPage: async (cursor) => {
      calls.page += 1;
      const i = cursor ? pages.findIndex((p) => p.cursor === cursor) + 1 : 0;
      return pages[i];
    },
    fetchDelta: async (_since, cursor) => {
      calls.delta += 1;
      const i = cursor ? deltas.findIndex((p) => p.cursor === cursor) + 1 : 0;
      return deltas[i];
    },
  };
}

describe("manifest", () => {
  beforeEach(resetDb);

  it("full sync pages by cursor, stores rows + header, and a later full sync sweeps rows the server dropped", async () => {
    const f = fetchersFrom([
      makePage({ pubB64: kp.pubB64, tickets: [row(TOKEN), row(TOKEN_2, 2, 1, "used", "Bob")], cursor: "c1" }),
      makePage({ pubB64: kp.pubB64, tickets: [row(TOKEN_3)], cursor: null }),
    ]);
    const meta = await syncManifestFull(f);
    expect(f.calls.page).toBe(2);
    expect(meta).toMatchObject({ eventId: "42", gen: 1, count: 3, publicKey: kp.pubB64, syncedAt: "2026-09-05T18:00:00.000Z" });
    expect((await lookupTicket(ticketHash(TOKEN_2))).effectiveStatus).toBe("used");
    expect((await lookupTicket(ticketHash(TOKEN))).entry).toMatchObject({ tt: 1, v: 1, n: "Alice", gen: 1 });

    // Second full sync without TOKEN_3 → it disappears.
    const f2 = fetchersFrom([makePage({ pubB64: kp.pubB64, tickets: [row(TOKEN), row(TOKEN_2)], cursor: null })]);
    const meta2 = await syncManifestFull(f2);
    expect(meta2.gen).toBe(2);
    expect((await lookupTicket(ticketHash(TOKEN_3))).effectiveStatus).toBe("missing");
    expect((await lookupTicket(ticketHash(TOKEN))).entry?.gen).toBe(2);
  });

  it("local admission marks survive a sync that still says valid and clear once the server says used", async () => {
    await syncManifestFull(fetchersFrom([makePage({ pubB64: kp.pubB64, tickets: [row(TOKEN)] })]));
    const h = ticketHash(TOKEN);
    await markUsedLocally(h, { deviceId: "dev-1", scanId: "s1", at: "2026-09-05T18:01:00.000Z" });
    expect(await lookupTicket(h)).toMatchObject({ effectiveStatus: "used_local", entry: { localDeviceId: "dev-1", localScanId: "s1" } });

    await syncManifestDelta(fetchersFrom([], [makePage({ pubB64: kp.pubB64, tickets: [row(TOKEN)], since: "x" })]));
    expect((await lookupTicket(h)).effectiveStatus).toBe("used_local");

    await syncManifestDelta(fetchersFrom([], [makePage({ pubB64: kp.pubB64, tickets: [row(TOKEN, 1, 1, "used")], since: "x" })]));
    expect((await lookupTicket(h)).effectiveStatus).toBe("used");
    expect((await lookupTicket(h)).entry?.localUsedAt).toBeNull();

    await clearLocalUsed(h);
    expect((await lookupTicket(h)).effectiveStatus).toBe("used");
  });

  it("delta adds new rows, refreshes the header (window override) and advances syncedAt", async () => {
    await syncManifestFull(fetchersFrom([makePage({ pubB64: kp.pubB64, tickets: [row(TOKEN)] })]));
    const meta = await syncManifestDelta(
      fetchersFrom([], [
        makePage({
          pubB64: kp.pubB64,
          tickets: [row(TOKEN_2, 2, 3, "valid", "Nino")],
          serverTime: "2026-09-05T18:10:00.000Z",
          window: { opensAt: "2026-09-05T17:00:00.000Z", closesAt: "2026-09-05T23:00:00.000Z" },
          since: "x",
        }),
      ])
    );
    expect(meta.count).toBe(2);
    expect(meta.syncedAt).toBe("2026-09-05T18:10:00.000Z");
    expect(meta.window.opensAt).toBe("2026-09-05T17:00:00.000Z");
    expect((await lookupTicket(ticketHash(TOKEN_2))).entry).toMatchObject({ v: 3, n: "Nino" });
  });

  it("ensureManifest: full when empty / other event / older than 12 h, delta otherwise; DELTA_TOO_OLD falls back to full", async () => {
    const pages = [makePage({ pubB64: kp.pubB64, tickets: [row(TOKEN)] })];
    const f = fetchersFrom(pages, [makePage({ pubB64: kp.pubB64, since: "x" })]);
    await ensureManifest(f, "42");
    expect(f.calls).toEqual({ page: 1, delta: 0 });
    await ensureManifest(f, "42");
    expect(f.calls).toEqual({ page: 1, delta: 1 });
    // other event → full again (and the old rows are gone)
    const f43 = fetchersFrom([makePage({ pubB64: kp.pubB64, eventId: "43", tickets: [row(TOKEN_3)] })]);
    await ensureManifest(f43, "43");
    expect(f43.calls.page).toBe(1);
    expect((await lookupTicket(ticketHash(TOKEN))).effectiveStatus).toBe("missing");
    // stale full sync → full
    const twelveHoursLater = Date.parse((await getManifestMeta())!.lastFullAt) + 13 * 3600_000;
    const f43b = fetchersFrom([makePage({ pubB64: kp.pubB64, eventId: "43", tickets: [row(TOKEN_3)] })]);
    await ensureManifest(f43b, "43", { nowMs: twelveHoursLater });
    expect(f43b.calls.page).toBe(1);
    // delta too old → full
    const tooOld: ManifestFetchers = {
      fetchPage: vi.fn(async () => makePage({ pubB64: kp.pubB64, eventId: "43", tickets: [row(TOKEN_3)] })),
      fetchDelta: vi.fn(async () => {
        throw new ManifestSyncError("too old", "DELTA_TOO_OLD");
      }),
    };
    await syncManifestDelta(tooOld);
    expect(tooOld.fetchPage).toHaveBeenCalledTimes(1);
  });

  it("offline name search is case-insensitive and capped; age labels", async () => {
    await syncManifestFull(fetchersFrom([makePage({ pubB64: kp.pubB64, tickets: [row(TOKEN, 1, 1, "valid", "Nino Beridze"), row(TOKEN_2, 1, 1, "valid", "Anna")] })]));
    expect((await searchManifestByName("nino")).map((r) => r.n)).toEqual(["Nino Beridze"]);
    expect(await searchManifestByName("n")).toEqual([]);
    expect(manifestAgeLabel(5 * 60_000)).toBe("ok");
    expect(manifestAgeLabel(30 * 60_000)).toBe("warn");
    expect(manifestAgeLabel(2 * 3_600_000)).toBe("stale");
  });
});
