"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { CameraOff } from "lucide-react";
import type { IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { HTTPError } from "ky";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { useOnline } from "@/hooks/use-online";
import { enqueueScan } from "@/lib/scan-queue";
import {
  parseScanServerResult,
  type ScanResult,
} from "@/types/scanner.types";
import { Text } from "@/components/ui/text";
import Spinner from "@/components/ui/spinner";
import ScanResultComponent from "./scan-result.component";
import ScannerHeaderComponent from "./scanner-header.component";

const Scanner = dynamic(
  () => import("@yudiel/react-qr-scanner").then((mod) => mod.Scanner),
  { ssr: false, loading: () => <CameraLoading /> }
);

const CameraScannerComponent = () => {
  const scanMode = useAuthStore((s) => s.scanMode);
  const online = useOnline();
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const isProcessingRef = useRef(false);

  const handleScan = useCallback(
    async (detectedCodes: IDetectedBarcode[]) => {
      if (isProcessingRef.current || scanResult) return;

      const code = detectedCodes[0];
      if (!code?.rawValue) return;

      isProcessingRef.current = true;
      setIsProcessing(true);

      const queueOffline = async () => {
        const rec = await enqueueScan(code.rawValue);
        setScanResult({ result: "queued", capturedAt: rec.capturedAt });
      };

      try {
        if (!navigator.onLine) {
          await queueOffline();
          return;
        }

        const response = await api.post("scan", {
          json: { payload: code.rawValue, scanId: crypto.randomUUID() },
        });
        const result = parseScanServerResult(await response.json());
        setScanResult(result);

        if (scanMode === "automatic" && result.result === "success") {
          setTimeout(() => setScanResult(null), 2000);
        }
      } catch (err) {
        // A dropped connection is NOT a rejected ticket — queue it or show an
        // amber "retry", never the red "Invalid" card (which would make staff
        // turn away valid holders).
        if (!navigator.onLine) {
          try {
            await queueOffline();
          } catch {
            setScanResult({
              result: "error",
              message: "Couldn't save the scan. Please try again.",
            });
          }
        } else if (err instanceof HTTPError) {
          // 401 is handled by the api hook (logout). Other 4xx/5xx (e.g. a 500
          // QR-decrypt failure) are shown as a retryable problem, not "invalid".
          let message = "Scan failed. Please try again.";
          try {
            const body = await err.response.json<{ message?: string }>();
            if (body?.message) message = body.message;
          } catch {
            /* keep default */
          }
          setScanResult({ result: "error", message });
        } else {
          setScanResult({
            result: "error",
            message: "Couldn't reach the server. Please try again.",
          });
        }
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    },
    [scanResult, scanMode]
  );

  const handleDismiss = useCallback(() => setScanResult(null), []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <ScannerHeaderComponent />

      {!online && (
        <div className="absolute inset-x-0 top-16 z-20 flex justify-center">
          <div className="rounded-full bg-warning px-4 py-1.5 shadow-lg">
            <Text variant="span2" className="text-white">
              Offline — scans are queued and will verify when back online
            </Text>
          </div>
        </div>
      )}

      {cameraError ? (
        <CameraPermissionError
          message={cameraError}
          onRetry={() => {
            setCameraError(null);
          }}
        />
      ) : (
        <Scanner
          onScan={handleScan}
          onError={(error) => {
            if (process.env.NODE_ENV !== "production") {
              // eslint-disable-next-line no-console
              console.error("Scanner error:", error);
            }
            setCameraError(
              "Camera unavailable. Grant camera permission in your browser settings, then retry."
            );
          }}
          formats={["qr_code"]}
          sound={scanMode !== "silent"}
          components={{ torch: true, finder: true }}
          styles={{
            container: { width: "100%", height: "100%" },
            video: {
              width: "100%",
              height: "100%",
              objectFit: "cover" as const,
            },
          }}
          paused={!!scanResult}
        />
      )}

      {isProcessing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
          <Spinner className="h-12 w-12 text-white" />
        </div>
      )}

      {scanResult && (
        <ScanResultComponent result={scanResult} onDismiss={handleDismiss} />
      )}
    </div>
  );
};

function CameraLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <Spinner className="h-10 w-10 text-white" />
    </div>
  );
}

function CameraPermissionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black px-8 text-center">
      <CameraOff className="h-12 w-12 text-white/70" />
      <Text variant="p" className="text-white">
        {message}
      </Text>
      <button
        onClick={onRetry}
        className="rounded-full bg-white px-6 py-2 font-medium text-black active:bg-white/80"
      >
        Retry
      </button>
    </div>
  );
}

export default CameraScannerComponent;
