// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CameraErrorPanelComponent from "@/components/scanner/camera-error-panel.component";
import { describeCameraError } from "@/lib/camera-error";

describe("CameraErrorPanelComponent", () => {
  // Production runs on HTTPS; jsdom reports an insecure context, which
  // describeCameraError (correctly) reports ahead of every other cause.
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });

  it("permission denied: OS steps, no Retry (cannot re-prompt), still offers camera choice + reload", () => {
    const info = describeCameraError(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    render(<CameraErrorPanelComponent info={info} attempt={0} onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Camera permission denied");
    expect(screen.queryByRole("button", { name: /Retry camera/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Choose a different camera/ })).toHaveAttribute("href", "/settings#camera");
    expect(screen.getByRole("button", { name: /Reload app/ })).toBeInTheDocument();
    expect(screen.getByText(/Lookup below/)).toBeInTheDocument();
  });

  it("camera busy: retry available and the automatic attempts are shown", () => {
    const info = describeCameraError(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    const onRetry = vi.fn();
    render(<CameraErrorPanelComponent info={info} attempt={3} onRetry={onRetry} />);
    expect(screen.getByText(/Tried 3 times automatically/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry camera/ }));
    expect(onRetry).toHaveBeenCalled();
  });
});
