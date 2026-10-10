import { describe, expect, it } from "vitest";

import { parseLoginHandoff } from "@/lib/login-handoff";

describe("parseLoginHandoff (D26)", () => {
  it.each([
    ["#code=1234-5678", { kind: "code", code: "12345678" }],
    ["#code=12345678", { kind: "code", code: "12345678" }],
    ["#code=1234%205678", { kind: "code", code: "12345678" }],
    ["code=ab12-cd34", { kind: "code", code: "AB12CD34" }],
    ["#username=gate_a", { kind: "username", username: "gate_a" }],
    ["#username=%20gate.a%20", { kind: "username", username: "gate.a" }],
    ["#username=%E1%83%92%E1%83%90%E1%83%A2%E1%83%94", { kind: "username", username: "გატე" }],
  ])("%s → %j", (hash, expected) => {
    expect(parseLoginHandoff(hash)).toEqual(expected);
  });

  it.each([
    ["", "nothing"],
    ["#", "an empty fragment"],
    ["#code=1234", "a partial code"],
    ["#code=1234-5678-9", "a code that is too long"],
    ["#username=", "an empty username"],
    ["#username=gate%20a", "a username with a space"],
    ["#username=" + "a".repeat(65), "a username over 64"],
    ["#next=/scan", "another key"],
  ])("%s (%s) → null", (hash) => {
    expect(parseLoginHandoff(hash)).toBeNull();
  });
});
