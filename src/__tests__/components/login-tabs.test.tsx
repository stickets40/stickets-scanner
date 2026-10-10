// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/api", () => ({ api: { post: vi.fn() }, describeFailure: () => "failed" }));
vi.mock("@/lib/device-id", () => ({ getDeviceId: () => "device-1" }));
vi.mock("@/lib/idb", () => ({ requestPersistentStorage: vi.fn() }));
vi.mock("@/lib/sw-registration", () => ({ precacheShell: vi.fn() }));
vi.mock("@/lib/runtime", () => ({ sessionRestored: vi.fn() }));
vi.mock("@/lib/feedback", () => ({ unlockAudio: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));
vi.mock("@/stores/auth.store", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ login: vi.fn() }),
}));

import LoginTabsComponent from "@/components/login/login-tabs.component";

// "Access code" names the tab, its panel (aria-labelledby) and the field, so the
// field is found by role.

const renderAt = async (hash: string) => {
  window.history.replaceState(null, "", `/login${hash}`);
  await act(async () => {
    render(<LoginTabsComponent />);
  });
};

describe("the hand-off link prefills the login (D26)", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/login");
  });

  it("survives the reload a fresh device does when its service worker takes over", async () => {
    await renderAt("#code=1234-5678");
    cleanup(); // the page reloads: same tab, the fragment already gone
    await renderAt("");
    expect(
      (screen.getByRole("textbox", { name: "Access code" }) as HTMLInputElement)
        .value
    ).toBe("1234-5678");
  });

  it("#code= fills the access code, then drops the fragment", async () => {
    await renderAt("#code=1234-5678");
    expect(
      (screen.getByRole("textbox", { name: "Access code" }) as HTMLInputElement)
        .value
    ).toBe("1234-5678");
    expect(window.location.hash).toBe("");
  });

  it("#username= opens the Account tab with the username filled", async () => {
    await renderAt("#username=gate_a");
    expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe(
      "gate_a"
    );
    expect(window.location.hash).toBe("");
  });

  it("a junk fragment is ignored (and still dropped)", async () => {
    await renderAt("#code=12");
    expect(screen.getByRole("tab", { name: "Access code" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(
      (screen.getByRole("textbox", { name: "Access code" }) as HTMLInputElement)
        .value
    ).toBe("");
    expect(window.location.hash).toBe("");
  });
});
