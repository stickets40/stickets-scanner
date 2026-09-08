import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration, formatElapsed, getSkewMs, now, recordServerTime, resetClock } from "@/lib/clock";

describe("clock", () => {
  afterEach(() => {
    resetClock();
    vi.useRealTimers();
  });

  it("estimates skew from the RTT midpoint and smooths over samples", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T18:00:00.000Z"));
    const t = Date.now();
    // server is 60 s ahead; request took 2 s
    recordServerTime(new Date(t + 60_000 + 1000).toISOString(), { startedAt: t, endedAt: t + 2000 });
    expect(getSkewMs()).toBe(60_000);
    expect(now()).toBe(t + 60_000);
    // a second, smaller sample averages in
    recordServerTime(new Date(t + 30_000).toISOString(), { startedAt: t, endedAt: t });
    expect(getSkewMs()).toBe(45_000);
  });

  it("ignores garbage and very slow responses", () => {
    recordServerTime("nope", { startedAt: 0, endedAt: 10 });
    expect(getSkewMs()).toBe(0);
    recordServerTime(new Date(Date.now() + 99_000).toISOString(), { startedAt: Date.now() - 20_000, endedAt: Date.now() });
    expect(getSkewMs()).toBe(0);
  });

  it("formats elapsed and durations", () => {
    const t = Date.parse("2026-09-05T18:00:00.000Z");
    expect(formatElapsed(new Date(t - 10_000).toISOString(), t)).toBe("just now");
    expect(formatElapsed(new Date(t - 4 * 60_000).toISOString(), t)).toBe("4 min ago");
    expect(formatElapsed(new Date(t - 3 * 3_600_000).toISOString(), t)).toBe("3h ago");
    expect(formatElapsed("bad", t)).toBe("earlier");
    expect(formatDuration(40_000)).toBe("40s");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(3 * 3_600_000 + 5 * 60_000)).toBe("3h 05m");
  });
});
