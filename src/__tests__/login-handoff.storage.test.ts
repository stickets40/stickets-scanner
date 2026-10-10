// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forgetLoginHandoff,
  LOGIN_HANDOFF_TTL_MS,
  takeLoginHandoff,
} from "@/lib/login-handoff";

const at = (url: string) => window.history.replaceState(null, "", url);

describe("the hand-off survives the first-visit reload, and nothing longer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    at("/login");
  });

  it("takes it from the link and drops the fragment", () => {
    at("/login#code=1234-5678");
    expect(takeLoginHandoff()).toEqual({ kind: "code", code: "12345678" });
    expect(window.location.hash).toBe("");
  });

  it("finds it again after the service worker's reload (same tab, no fragment)", () => {
    at("/login#username=gate_a");
    takeLoginHandoff();
    at("/login");
    expect(takeLoginHandoff()).toEqual({ kind: "username", username: "gate_a" });
  });

  it("is forgotten once sign-in succeeds", () => {
    at("/login#code=1234-5678");
    takeLoginHandoff();
    forgetLoginHandoff();
    at("/login");
    expect(takeLoginHandoff()).toBeNull();
  });

  it("expires: a later visit to /login in the same tab starts blank", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    at("/login#code=1234-5678");
    takeLoginHandoff();
    now.mockReturnValue(1_000_000 + LOGIN_HANDOFF_TTL_MS + 1);
    at("/login");
    expect(takeLoginHandoff()).toBeNull();
  });

  it("a junk link stashes nothing", () => {
    at("/login#code=12");
    expect(takeLoginHandoff()).toBeNull();
    at("/login");
    expect(takeLoginHandoff()).toBeNull();
  });
});
