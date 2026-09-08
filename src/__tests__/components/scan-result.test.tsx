// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ScanResultComponent from "@/components/scanner/scan-result.component";
import type { Verdict } from "@/types/verdict.types";

const renderVerdict = (verdict: Verdict, over: Partial<React.ComponentProps<typeof ScanResultComponent>> = {}) => {
  const props = {
    verdict,
    busy: false,
    onDismiss: vi.fn(),
    onChoose: vi.fn(),
    onTryOnline: vi.fn(),
    onUndo: vi.fn(async () => null),
    ...over,
  };
  render(<ScanResultComponent {...props} />);
  return props;
};

describe("ScanResultComponent", () => {
  it("IN: name, type, an Undo button while the window is open, and tap-to-dismiss", () => {
    const props = renderVerdict({
      kind: "success",
      scanId: "s",
      ticket: { ownerName: "Alice", ticketTypeName: "GA", seatInfo: { section: 3 } },
      server: {
        result: "success",
        scanLogId: "l",
        undoableUntil: new Date(Date.now() + 4 * 60_000).toISOString(),
        ticket: { ownerName: "Alice", ticketTypeName: "GA", ticketTypeId: 1, nftId: "t", tokenId: "t", seatInfo: { section: 3 } },
        serverTime: new Date().toISOString(),
      },
    });
    expect(screen.getByText("IN")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/GA · Section 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Undo/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("status"));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("replayed success shows 'Already recorded'", () => {
    renderVerdict({
      kind: "success",
      scanId: "s",
      ticket: { ownerName: "Alice", ticketTypeName: "GA" },
      server: {
        result: "success",
        scanLogId: "l",
        undoableUntil: new Date().toISOString(),
        ticket: { ownerName: "Alice", ticketTypeName: "GA", ticketTypeId: 1, nftId: "t", tokenId: "t", seatInfo: null },
        serverTime: new Date().toISOString(),
        replayed: true,
      },
    });
    expect(screen.getByText("Already recorded")).toBeInTheDocument();
  });

  it("USED names the gate that admitted them", () => {
    renderVerdict({
      kind: "already_used",
      scanId: "s",
      ticket: { ownerName: "Bob", ticketTypeName: "" },
      server: {
        result: "already_used",
        ticket: { ownerName: "Bob", seatInfo: null, firstUsedAt: new Date(Date.now() - 5 * 60_000).toISOString(), tokenId: "t" },
        firstScannedBy: { scannerId: "s2", scannerName: "Gate B", deviceId: "d9" },
        secondsAgo: 300,
        sameDevice: false,
        serverTime: new Date().toISOString(),
      },
    });
    expect(screen.getByText("USED")).toBeInTheDocument();
    expect(screen.getByText(/at Gate B/)).toBeInTheDocument();
  });

  it("choice card: Admit unverified / Deny / Try online; the backdrop does NOT dismiss it", () => {
    const props = renderVerdict({
      kind: "authentic_not_in_manifest",
      scanId: "s",
      payload: "ST3.x",
      hint: { h: "h", tokenId: "t", eventId: "42" },
      manifestAgeMs: 120_000,
      canTryOnline: true,
    });
    expect(screen.getByText("VALID TICKET")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("status"));
    expect(props.onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try online" }));
    expect(props.onTryOnline).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Admit unverified" }));
    expect(props.onChoose).toHaveBeenCalledWith("admit");
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(props.onChoose).toHaveBeenCalledWith("deny");
  });

  it("outside window says the ticket was not consumed", () => {
    renderVerdict({ kind: "outside_window", scanId: "s", source: "offline", reason: "too_early", opensAt: new Date().toISOString(), closesAt: new Date().toISOString(), ticket: { ownerName: "Nino", ticketTypeName: "GA" } });
    expect(screen.getByText("TOO EARLY")).toBeInTheDocument();
    expect(screen.getByText(/Not consumed/)).toBeInTheDocument();
  });

  it("Undo surfaces the returned error", async () => {
    const onUndo = vi.fn(async () => "The undo window has closed.");
    renderVerdict({ kind: "success_offline", scanId: "s", ticket: { ownerName: "A", ticketTypeName: "GA" }, capturedAt: new Date().toISOString(), manifestAgeMs: 1000 }, { onUndo });
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The undo window has closed.");
  });
});
