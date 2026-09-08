/**
 * Connectivity is a three-state estimate, not `navigator.onLine`.
 *
 *   online    a request or probe succeeded recently and nothing failed since
 *   degraded  the browser says online but requests are failing / timing out
 *             (captive portal, venue Wi-Fi with no upstream, flaky 4G)
 *   offline   the browser reports no network at all
 *
 * The old code trusted navigator.onLine, so on a captive Wi-Fi every scan sat
 * through a 10 s timeout and then showed an error instead of falling back to
 * the offline path. Here one failure flips to `degraded`, the engine goes
 * offline-first immediately, and a cheap /api/health probe (3 s) decides when
 * to trust the network again.
 */
export type ConnectivityStatus = "online" | "degraded" | "offline";

export type ConnectivityEvent =
  | { type: "BROWSER_ONLINE" }
  | { type: "BROWSER_OFFLINE" }
  | { type: "REQUEST_OK" }
  | { type: "REQUEST_FAIL" }
  | { type: "PROBE_OK" }
  | { type: "PROBE_FAIL" }
  | { type: "RATE_LIMITED"; until: number }
  | { type: "VISIBLE" };

export interface ConnectivityState {
  status: ConnectivityStatus;
  browserOnline: boolean;
  consecutiveFailures: number;
  lastOkAt: number | null;
  lastFailAt: number | null;
  rateLimitedUntil: number | null;
}

export const INITIAL_CONNECTIVITY: ConnectivityState = {
  status: "online",
  browserOnline: true,
  consecutiveFailures: 0,
  lastOkAt: null,
  lastFailAt: null,
  rateLimitedUntil: null,
};

export function reduceConnectivity(state: ConnectivityState, event: ConnectivityEvent, now: number): ConnectivityState {
  switch (event.type) {
    case "BROWSER_OFFLINE":
      return { ...state, browserOnline: false, status: "offline" };
    case "BROWSER_ONLINE":
      // The link is back but nothing has proven the upstream yet — degraded
      // until a probe or a real request succeeds.
      return { ...state, browserOnline: true, status: state.status === "offline" ? "degraded" : state.status };
    case "REQUEST_OK":
    case "PROBE_OK":
      return {
        ...state,
        browserOnline: true,
        status: "online",
        consecutiveFailures: 0,
        lastOkAt: now,
      };
    case "REQUEST_FAIL":
    case "PROBE_FAIL":
      return {
        ...state,
        consecutiveFailures: state.consecutiveFailures + 1,
        lastFailAt: now,
        status: state.browserOnline ? "degraded" : "offline",
      };
    case "RATE_LIMITED":
      return { ...state, rateLimitedUntil: Math.max(state.rateLimitedUntil ?? 0, event.until) };
    case "VISIBLE":
      return state;
  }
}

/** navigator.onLine where the platform has one (Node's navigator does not) — else assume online. */
export function browserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  const value = (navigator as { onLine?: unknown }).onLine;
  return typeof value === "boolean" ? value : true;
}

export function isRateLimited(state: ConnectivityState, now: number): boolean {
  return state.rateLimitedUntil != null && now < state.rateLimitedUntil;
}

/** Only a confirmed-good network gets live scans; degraded goes offline-first. */
export function isEffectivelyOnline(state: ConnectivityState, now = Date.now()): boolean {
  return state.status === "online" && !isRateLimited(state, now);
}

type Listener = (state: ConnectivityState) => void;

export interface ConnectivityMonitorOptions {
  probe: () => Promise<boolean>;
  /** How often to re-probe while degraded. */
  probeIntervalMs?: number;
  /** Minimum gap between probes triggered by failures. */
  probeDebounceMs?: number;
  now?: () => number;
}

/**
 * Runtime monitor: holds the state, listens to the browser, probes when
 * degraded. Pure reducer above; this is the only place with timers.
 */
export function createConnectivityMonitor(opts: ConnectivityMonitorOptions) {
  const nowFn = opts.now ?? (() => Date.now());
  const probeInterval = opts.probeIntervalMs ?? 20_000;
  const probeDebounce = opts.probeDebounceMs ?? 2_000;
  let state: ConnectivityState = {
    ...INITIAL_CONNECTIVITY,
    browserOnline: browserOnline(),
    status: browserOnline() ? "online" : "offline",
  };
  const listeners = new Set<Listener>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastProbeAt = 0;
  let probing = false;

  const emit = () => listeners.forEach((l) => l(state));

  const dispatch = (event: ConnectivityEvent) => {
    const next = reduceConnectivity(state, event, nowFn());
    const changed = next !== state;
    state = next;
    if (changed) emit();
    if (event.type === "REQUEST_FAIL" || event.type === "BROWSER_ONLINE" || event.type === "VISIBLE") {
      if (state.status === "degraded") void probeNow();
    }
    syncTimer();
  };

  const probeNow = async () => {
    const t = nowFn();
    if (probing || t - lastProbeAt < probeDebounce || !state.browserOnline) return;
    probing = true;
    lastProbeAt = t;
    try {
      const ok = await opts.probe();
      dispatch(ok ? { type: "PROBE_OK" } : { type: "PROBE_FAIL" });
    } catch {
      dispatch({ type: "PROBE_FAIL" });
    } finally {
      probing = false;
    }
  };

  const syncTimer = () => {
    const shouldTick = state.status === "degraded";
    if (shouldTick && !timer) timer = setInterval(() => void probeNow(), probeInterval);
    if (!shouldTick && timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onOnline = () => dispatch({ type: "BROWSER_ONLINE" });
  const onOffline = () => dispatch({ type: "BROWSER_OFFLINE" });
  const onVisible = () => {
    if (document.visibilityState === "visible") dispatch({ type: "VISIBLE" });
  };

  return {
    getState: () => state,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    probeNow,
    start() {
      if (typeof window === "undefined") return;
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      document.addEventListener("visibilitychange", onVisible);
      syncTimer();
    },
    stop() {
      if (typeof window === "undefined") return;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type ConnectivityMonitor = ReturnType<typeof createConnectivityMonitor>;

let singleton: ConnectivityMonitor | null = null;

/** App-wide monitor probing GET /api/health. */
export function getConnectivityMonitor(): ConnectivityMonitor {
  if (singleton) return singleton;
  singleton = createConnectivityMonitor({
    probe: async () => {
      const startedAt = Date.now();
      // 5 s: the BFF itself waits up to 3 s on the upstream before answering.
      const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!res.ok) return false;
      const serverTime = res.headers.get("x-server-time");
      if (serverTime) {
        const { recordServerTime } = await import("@/lib/clock");
        recordServerTime(serverTime, { startedAt, endedAt: Date.now() });
      }
      // The BFF answering is not enough: "online" means the ticket server is
      // reachable THROUGH it, otherwise every live scan would time out first.
      const body = (await res.json().catch(() => null)) as { upstream?: string } | null;
      return body?.upstream !== "down";
    },
  });
  return singleton;
}
