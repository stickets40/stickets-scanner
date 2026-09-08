import { describe, expect, it, vi } from "vitest";
import {
  createConnectivityMonitor,
  INITIAL_CONNECTIVITY,
  isEffectivelyOnline,
  reduceConnectivity,
  type ConnectivityState,
} from "@/lib/connectivity";

describe("connectivity reducer", () => {
  const at = 1000;
  it.each<[ConnectivityState["status"], string, ConnectivityState["status"]]>([
    ["online", "REQUEST_FAIL", "degraded"],
    ["online", "PROBE_FAIL", "degraded"],
    ["degraded", "REQUEST_OK", "online"],
    ["degraded", "PROBE_OK", "online"],
    ["online", "BROWSER_OFFLINE", "offline"],
    ["offline", "BROWSER_ONLINE", "degraded"],
    ["degraded", "VISIBLE", "degraded"],
  ])("%s + %s → %s", (from, type, to) => {
    const state = { ...INITIAL_CONNECTIVITY, status: from, browserOnline: from !== "offline" };
    expect(reduceConnectivity(state, { type } as never, at).status).toBe(to);
  });

  it("a failure while the browser says offline stays offline; successes reset the failure count", () => {
    let s: ConnectivityState = { ...INITIAL_CONNECTIVITY, status: "offline", browserOnline: false };
    s = reduceConnectivity(s, { type: "REQUEST_FAIL" }, at);
    expect(s.status).toBe("offline");
    expect(s.consecutiveFailures).toBe(1);
    s = reduceConnectivity(s, { type: "REQUEST_OK" }, at);
    expect(s).toMatchObject({ status: "online", browserOnline: true, consecutiveFailures: 0, lastOkAt: at });
  });

  it("rate limiting makes the network 'not effectively online' until the deadline", () => {
    const s = reduceConnectivity(INITIAL_CONNECTIVITY, { type: "RATE_LIMITED", until: 5000 }, at);
    expect(isEffectivelyOnline(s, 4000)).toBe(false);
    expect(isEffectivelyOnline(s, 5001)).toBe(true);
    expect(isEffectivelyOnline({ ...INITIAL_CONNECTIVITY, status: "degraded" }, 0)).toBe(false);
  });
});

describe("connectivity monitor", () => {
  it("probes immediately after a failure and recovers on a good probe", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const m = createConnectivityMonitor({ probe, probeDebounceMs: 0, probeIntervalMs: 60_000 });
    m.dispatch({ type: "REQUEST_FAIL" });
    expect(m.getState().status).toBe("degraded");
    await vi.waitFor(() => expect(m.getState().status).toBe("online"));
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("keeps probing on the interval while degraded, and stops once online", async () => {
    vi.useFakeTimers();
    const probe = vi.fn().mockResolvedValue(false);
    const m = createConnectivityMonitor({ probe, probeDebounceMs: 0, probeIntervalMs: 1000 });
    m.dispatch({ type: "REQUEST_FAIL" });
    await vi.advanceTimersByTimeAsync(3100);
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(3);
    probe.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(1100);
    expect(m.getState().status).toBe("online");
    const calls = probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(probe.mock.calls.length).toBe(calls);
    vi.useRealTimers();
  });

  it("notifies subscribers only on change", () => {
    const m = createConnectivityMonitor({ probe: async () => true });
    const listener = vi.fn();
    m.subscribe(listener);
    m.dispatch({ type: "VISIBLE" });
    expect(listener).not.toHaveBeenCalled();
    m.dispatch({ type: "BROWSER_OFFLINE" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
