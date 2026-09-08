// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ScannerHeaderComponent from "@/components/scanner/scanner-header.component";
import { EMPTY_QUEUE_COUNTS, useSessionStore } from "@/stores/session.store";
import { useAuthStore } from "@/stores/auth.store";

describe("ScannerHeaderComponent", () => {
  beforeEach(() => {
    useAuthStore.setState({ scanner: { scannerId: "s1", name: "Gate A", eventId: "42", eventName: "Summer Fest", allowedTicketTypeIds: [] } });
    useSessionStore.setState({ auth: "authenticated", queue: EMPTY_QUEUE_COUNTS, venue: null, manifest: null, idbUnavailable: false, renewalFailed: false });
  });

  it("shows the entrance, the event and the venue count", () => {
    useSessionStore.setState({ venue: { admitted: 412, total: 1200, asOf: new Date().toISOString() }, venueStale: false });
    render(<ScannerHeaderComponent onOpenQueue={vi.fn()} onOpenReauth={vi.fn()} />);
    expect(screen.getByText("Gate A")).toBeInTheDocument();
    expect(screen.getByText("Summer Fest")).toBeInTheDocument();
    expect(screen.getByText(/412 \/ 1,200 in/)).toBeInTheDocument();
  });

  it("review conflicts outrank everything and open the shift log; a dead session offers re-auth", () => {
    const onOpenQueue = vi.fn();
    const onOpenReauth = vi.fn();
    useSessionStore.setState({
      auth: "reauth_required",
      authErrorCode: "SCANNER_TOKEN_EXPIRED",
      queue: { ...EMPTY_QUEUE_COUNTS, needsReview: 2, pending: 5, unverified: 5, stalled: 1 },
    });
    render(<ScannerHeaderComponent onOpenQueue={onOpenQueue} onOpenReauth={onOpenReauth} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["2 to review", "Sign in again", "5 queued"]);
    buttons[0].click();
    expect(onOpenQueue).toHaveBeenCalled();
    buttons[1].click();
    expect(onOpenReauth).toHaveBeenCalled();
  });

  it("live-only mode is flagged when storage is unavailable", () => {
    useSessionStore.setState({ idbUnavailable: true });
    render(<ScannerHeaderComponent onOpenQueue={vi.fn()} onOpenReauth={vi.fn()} />);
    expect(screen.getByText("Live only")).toBeInTheDocument();
  });
});
