"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { useAuthStore } from "@/stores/auth.store";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { useCameraLifecycle } from "@/hooks/use-camera-lifecycle";
import { useScanPipeline } from "@/hooks/use-scan-pipeline";
import { useLiveStats } from "@/hooks/use-live-stats";
import { shiftTally } from "@/lib/shift-log";
import { SHIFT_CHANGED_EVENT } from "@/lib/events";
import { unlockAudio } from "@/lib/feedback";
import { precacheShell } from "@/lib/sw-registration";
import Spinner from "@/components/ui/spinner";
import ScanResultComponent from "./scan-result.component";
import ScannerHeaderComponent from "./scanner-header.component";
import ScannerControlsComponent from "./scanner-controls.component";
import ShiftSheetComponent from "./shift-sheet.component";
import LookupSheetComponent from "./lookup-sheet.component";
import CameraErrorPanelComponent from "./camera-error-panel.component";
import ReauthSheetComponent from "./reauth-sheet.component";

// The decoder's WebAssembly is served by us (public/zxing, precached by the
// service worker) — never from a CDN, which the CSP blocks and a venue without
// internet cannot reach. Configured once, before the first Scanner mounts.
const Scanner = dynamic(
  () =>
    import("@yudiel/react-qr-scanner").then((mod) => {
      mod.prepareZXingModule({
        overrides: { locateFile: (path: string) => `/zxing/${path}` },
        fireImmediately: true,
      });
      return mod.Scanner;
    }),
  { ssr: false, loading: () => <CameraLoading /> }
);

const CameraScannerComponent = () => {
  const preferredCameraId = useAuthStore((s) => s.preferredCameraId);
  const camera = useCameraLifecycle(preferredCameraId);
  const pipeline = useScanPipeline();
  const [shiftOpen, setShiftOpen] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [admitted, setAdmitted] = useState(0);

  useWakeLock(true);
  useLiveStats(true);

  const refreshAdmitted = useCallback(() => {
    void shiftTally()
      .then((t) => setAdmitted(t.admitted + t.admittedOffline + t.admittedUnverified - t.undone))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshAdmitted();
    window.addEventListener(SHIFT_CHANGED_EVENT, refreshAdmitted);
    return () => window.removeEventListener(SHIFT_CHANGED_EVENT, refreshAdmitted);
  }, [refreshAdmitted]);

  // Browsers won't start an AudioContext without a gesture; unlock on the first touch.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Every visit to the camera makes sure the shell is servable offline.
  useEffect(() => {
    precacheShell();
  }, []);

  const handleScan = useCallback(
    (codes: IDetectedBarcode[]) => {
      const raw = codes[0]?.rawValue;
      if (raw) void pipeline.handleDetected(raw);
    },
    [pipeline]
  );

  const cameraDown = camera.phase === "error_final";
  const paused = !!pipeline.verdict || shiftOpen || lookupOpen || reauthOpen;

  return (
    // no-select is scoped here: a stray long-press during a scan is noise, but
    // operators still need to select and copy holder names everywhere else.
    <div className="relative h-dvh w-full overflow-hidden bg-surface-0 no-select">
      {cameraDown ? (
        <CameraErrorPanelComponent info={camera.error!} attempt={camera.attempt} onRetry={camera.retry} />
      ) : (
        <Scanner
          key={camera.mountKey}
          onScan={handleScan}
          onError={camera.onError}
          constraints={camera.constraints}
          formats={["qr_code"]}
          // OFF, deliberately. Replaced by result-driven tones in lib/feedback.
          sound={false}
          allowMultiple={false}
          components={{ torch: true, finder: true }}
          styles={{
            container: { width: "100%", height: "100%" },
            video: { width: "100%", height: "100%", objectFit: "cover" as const },
          }}
          paused={paused}
        />
      )}

      <ScannerHeaderComponent onOpenQueue={() => setShiftOpen(true)} onOpenReauth={() => setReauthOpen(true)} />

      <ScannerControlsComponent onOpenShift={() => setShiftOpen(true)} onOpenLookup={() => setLookupOpen(true)} admittedCount={admitted} />

      {pipeline.busy && !pipeline.verdict && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/50" role="status" aria-live="polite">
          <Spinner className="h-10 w-10 text-white" />
          <p className="text-sm font-medium text-white/90">Checking ticket…</p>
        </div>
      )}

      {pipeline.verdict && (
        <ScanResultComponent
          verdict={pipeline.verdict}
          busy={pipeline.busy}
          onDismiss={pipeline.dismiss}
          onChoose={(d) => void pipeline.choose(d)}
          onTryOnline={() => void pipeline.tryOnline()}
          onUndo={pipeline.undo}
        />
      )}

      <ShiftSheetComponent open={shiftOpen} onClose={() => setShiftOpen(false)} onChanged={refreshAdmitted} />
      <LookupSheetComponent open={lookupOpen} onClose={() => setLookupOpen(false)} onCheckedIn={pipeline.presentServerVerdict} />
      <ReauthSheetComponent forceOpen={reauthOpen} onClosed={() => setReauthOpen(false)} />
    </div>
  );
};

function CameraLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-0" role="status" aria-label="Starting camera">
      <Spinner className="h-10 w-10 text-white" />
    </div>
  );
}

export default CameraScannerComponent;
