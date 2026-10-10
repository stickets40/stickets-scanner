/**
 * The organizer's hand-off link (web app, D26): `/login#code=1234-5678` or
 * `/login#username=gate_a`. A FRAGMENT on purpose — browsers never send it to any
 * server, so the code does not reach logs or referrers. It only PREFILLS the form:
 * the operator still signs in (no token rides in the link).
 */
export type LoginHandoff =
  | { kind: "code"; code: string }
  | { kind: "username"; username: string }
  | null;

const CODE_LENGTH = 8;
const USERNAME = /^[\p{L}\p{N}._@-]{1,64}$/u;

/**
 * Reads a hand-off from `location.hash`. Only a complete code (8 characters once
 * the dash and spaces are dropped) or a plausible username counts; anything else —
 * a partial code, junk, an empty fragment, other keys — is ignored (null). The
 * query string is not read: a code there would be sent to the server.
 */
export function parseLoginHandoff(hash: string): LoginHandoff {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const code = params.get("code");
  if (code !== null) {
    const clean = code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return clean.length === CODE_LENGTH ? { kind: "code", code: clean } : null;
  }
  const username = params.get("username");
  if (username !== null) {
    const trimmed = username.trim();
    return USERNAME.test(trimmed) ? { kind: "username", username: trimmed } : null;
  }
  return null;
}

/** Drops the fragment, so a reload, a back swipe or a screenshot does not carry the code. */
export function clearLoginHandoff(): void {
  try {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search
    );
  } catch {
    /* a sandboxed history API: the fragment simply stays */
  }
}

// ── Surviving the first-visit reload ────────────────────────────────────────────
// On a device's first visit the service worker takes control and the app reloads
// once (sw-registration: controllerchange). A fresh phone opening the hand-off link
// is exactly that case, so the fragment is copied to sessionStorage (this tab only)
// before it is dropped from the URL, and forgotten as soon as sign-in succeeds.

const STASH_KEY = "st.loginHandoff";
/** A stash older than this is ignored (a later visit to /login in the same tab). */
export const LOGIN_HANDOFF_TTL_MS = 10 * 60 * 1000;

const stash = (fragment: string): void => {
  try {
    window.sessionStorage.setItem(
      STASH_KEY,
      JSON.stringify({ fragment, at: Date.now() })
    );
  } catch {
    /* storage blocked: the prefill just does not survive a reload */
  }
};

const readStash = (): LoginHandoff => {
  try {
    const stored = window.sessionStorage.getItem(STASH_KEY);
    if (!stored) return null;
    const { fragment, at } = JSON.parse(stored) as {
      fragment?: unknown;
      at?: unknown;
    };
    if (
      typeof fragment !== "string" ||
      typeof at !== "number" ||
      Date.now() - at > LOGIN_HANDOFF_TTL_MS
    ) {
      window.sessionStorage.removeItem(STASH_KEY);
      return null;
    }
    return parseLoginHandoff(fragment);
  } catch {
    return null;
  }
};

/**
 * The hand-off for this visit: from the link (then off the URL, into the stash),
 * else from a recent stash — the reload a fresh device does on its first visit.
 */
export function takeLoginHandoff(): LoginHandoff {
  const hash = window.location.hash;
  const fromLink = parseLoginHandoff(hash);
  if (hash) clearLoginHandoff();
  if (fromLink) {
    stash(hash.slice(1));
    return fromLink;
  }
  return readStash();
}

/** Signed in: the code has done its job. */
export function forgetLoginHandoff(): void {
  try {
    window.sessionStorage.removeItem(STASH_KEY);
  } catch {
    /* nothing stored, or storage blocked */
  }
}
