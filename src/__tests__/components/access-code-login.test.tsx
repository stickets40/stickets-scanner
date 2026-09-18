// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The access-code field ate characters, and the cause is CARET LOSS.
 *
 * The old version stored the formatted string and returned it unchanged for any
 * keystroke the mask rejects — a "-", a space, a punctuation mark. React saw no
 * state change, restored the DOM value it already believed in, and in doing so moved
 * the caret to the END of the field. Silently: the visible text was identical, so
 * nothing hinted that it had happened.
 *
 * For the operator that reads as: put the caret mid-code to fix a digit, press "-",
 * nothing appears — press again, still nothing — then press Backspace expecting to
 * remove the dash, and a real character vanishes from wherever the caret went. Which
 * is the report, verbatim: "typing - does nothing, and after pressing it 2 times it
 * starts deleting what is already written."
 *
 * The caret assertions are the ones that fail against the old component; the rest
 * lock in behaviour that was already correct, so a future rewrite cannot regress it.
 * They drive the real input through user-event rather than testing the formatter in
 * isolation, because the defect lived between React and the DOM, where a pure
 * function test cannot see it.
 */

const post = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { post: (...a: unknown[]) => post(...a) },
  describeFailure: () => "failed",
}));
vi.mock("@/lib/device-id", () => ({ getDeviceId: () => "device-1" }));
vi.mock("@/lib/idb", () => ({ requestPersistentStorage: vi.fn() }));
vi.mock("@/lib/sw-registration", () => ({ precacheShell: vi.fn() }));
vi.mock("@/lib/runtime", () => ({ sessionRestored: vi.fn() }));
vi.mock("@/lib/feedback", () => ({ unlockAudio: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/stores/auth.store", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ login: vi.fn() }),
}));

import AccessCodeLoginComponent from "@/components/login/access-code-login.component";

const field = () => screen.getByLabelText("Access code") as HTMLInputElement;

describe("access code field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    post.mockResolvedValue({ ok: false, status: 401 });
  });

  it("inserts the separator itself as you type", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);

    await user.type(field(), "12345678");

    expect(field().value).toBe("1234-5678");
  });

  it("a typed dash is absorbed rather than accumulated", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);
    const input = field();

    await user.type(input, "12345678");
    await user.type(input, "-");
    await user.type(input, "-");

    expect(input.value).toBe("1234-5678");
  });

  it("backspace after those dashes deletes exactly one character", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);
    const input = field();

    await user.type(input, "12345678--");
    await user.type(input, "{Backspace}");

    expect(input.value).toBe("1234-567");
  });

  it("backspacing across the separator removes a digit, not the dash", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);
    const input = field();

    await user.type(input, "12345");
    expect(input.value).toBe("1234-5");

    await user.type(input, "{Backspace}");
    expect(input.value).toBe("1234");

    await user.type(input, "{Backspace}");
    expect(input.value).toBe("123");
  });

  it("stops at eight characters", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);

    await user.type(field(), "1234567890");

    expect(field().value).toBe("1234-5678");
  });

  it("upper-cases and drops anything that is not part of a code", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);

    await user.type(field(), "ab cd/ef gh");

    expect(field().value).toBe("ABCD-EFGH");
  });

  it("keeps the caret in place when editing mid-code", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);
    const input = field();

    await user.type(input, "12345678");
    // user-event clicks before typing, which parks the caret at the end — the
    // insertion point has to be declared, not set beforehand.
    await user.type(input, "9", {
      initialSelectionStart: 2,
      initialSelectionEnd: 2,
    });

    // "12" + "9" + "345678" capped to eight -> 1293-4567, caret after the 9.
    expect(input.value).toBe("1293-4567");
    expect(input.selectionStart).toBe(3);
  });

  it("a rejected keystroke leaves the caret alone (THE BUG)", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);
    const input = field();

    await user.type(input, "12345678");
    // Operator puts the caret between "12" and "34" to fix a digit, then hits "-".
    await user.type(input, "-", {
      initialSelectionStart: 2,
      initialSelectionEnd: 2,
    });

    expect(input.value).toBe("1234-5678");
    // Previously this was 9 — the caret had silently jumped to the end, which is what
    // made the next Backspace delete the wrong character.
    expect(input.selectionStart).toBe(2);
  });

  it("stays put across repeated rejected keystrokes", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);
    const input = field();

    await user.type(input, "12345678");
    for (const key of ["-", "-", " ", "/"]) {
      await user.type(input, key, {
        initialSelectionStart: 3,
        initialSelectionEnd: 3,
      });
    }

    expect(input.value).toBe("1234-5678");
    expect(input.selectionStart).toBe(3);
  });

  it("submits the canonical XXXX-XXXX form", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);

    await user.type(field(), "12345678");
    await user.click(screen.getByRole("button", { name: /open scanner/i }));

    expect(post).toHaveBeenCalledWith(
      "auth/access-code",
      expect.objectContaining({ accessCode: "1234-5678" }),
      expect.anything()
    );
  });

  it("refuses a short code without calling the API", async () => {
    const user = userEvent.setup();
    render(<AccessCodeLoginComponent />);

    await user.type(field(), "1234");
    await user.click(screen.getByRole("button", { name: /open scanner/i }));

    expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/full 8-character/i);
  });
});
