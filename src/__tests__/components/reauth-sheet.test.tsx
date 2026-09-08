// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ReauthSheetComponent from "@/components/scanner/reauth-sheet.component";
import { useSessionStore } from "@/stores/session.store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

describe("ReauthSheetComponent", () => {
  beforeEach(() => {
    useSessionStore.setState({ auth: "authenticated", authErrorCode: null, connectivity: "online" });
  });

  it("renders nothing while the session is fine", () => {
    render(<ReauthSheetComponent forceOpen={false} onClosed={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains the backend's reason and offers the inline sign-in when online", () => {
    useSessionStore.setState({ auth: "reauth_required", authErrorCode: "SCANNER_TOKEN_REVOKED", connectivity: "online" });
    render(<ReauthSheetComponent forceOpen={false} onClosed={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Access was reset")).toBeInTheDocument();
    expect(screen.getByLabelText("Access code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Later/ })).toBeInTheDocument();
  });

  it("offline: no form, just 'keep scanning offline'", () => {
    useSessionStore.setState({ auth: "reauth_required", authErrorCode: "SCANNER_TOKEN_EXPIRED", connectivity: "offline" });
    render(<ReauthSheetComponent forceOpen={false} onClosed={() => {}} />);
    expect(screen.getByText("Session expired")).toBeInTheDocument();
    expect(screen.queryByLabelText("Access code")).toBeNull();
    expect(screen.getByRole("button", { name: /Keep scanning offline/ })).toBeInTheDocument();
  });
});
