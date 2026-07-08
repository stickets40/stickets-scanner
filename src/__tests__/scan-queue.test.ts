import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueueScan,
  pendingCount,
  drainQueue,
} from "@/lib/scan-queue";

function resetDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("stickets-scanner");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

const successData = {
  result: "success",
  ticket: {
    ownerName: "Alice",
    ticketTypeName: "GA",
    nftId: "1",
    tokenId: "1",
    seatInfo: null,
  },
};

describe("offline scan queue", () => {
  beforeEach(resetDb);

  it("de-dupes re-scans of the same payload and keeps a stable scanId", async () => {
    const a = await enqueueScan("PAYLOAD_X");
    const b = await enqueueScan("PAYLOAD_X");
    expect(b.scanId).toBe(a.scanId);
    expect(await pendingCount()).toBe(1);
  });

  it("counts distinct payloads separately", async () => {
    await enqueueScan("A");
    await enqueueScan("B");
    expect(await pendingCount()).toBe(2);
  });

  it("marks records synced on a 2xx and clears the pending count", async () => {
    await enqueueScan("A");
    const synced = await drainQueue(async () => ({
      ok: true,
      status: 200,
      data: successData,
    }));
    expect(synced).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  it("keeps a record pending (retryable) on a 5xx", async () => {
    await enqueueScan("A");
    const synced = await drainQueue(async () => ({
      ok: false,
      status: 503,
      data: null,
    }));
    expect(synced).toBe(0);
    expect(await pendingCount()).toBe(1); // still pending → will retry
  });

  it("marks a record failed on a permanent 4xx", async () => {
    await enqueueScan("A");
    await drainQueue(async () => ({ ok: false, status: 400, data: null }));
    // failed records are still surfaced for manual review by pendingCount
    expect(await pendingCount()).toBe(1);
  });

  it("sends the stable scanId to the poster", async () => {
    const rec = await enqueueScan("A");
    let seenScanId: string | undefined;
    await drainQueue(async (body) => {
      seenScanId = body.scanId;
      return { ok: true, status: 200, data: successData };
    });
    expect(seenScanId).toBe(rec.scanId);
  });
});
