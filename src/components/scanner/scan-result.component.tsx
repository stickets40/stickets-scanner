"use client";

import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRightLeft,
  CloudOff,
  WifiOff,
} from "lucide-react";
import type { ScanResult, ScanResultType } from "@/types/scanner.types";
import { cn } from "@/lib/cn";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/ui/pill";
import Button from "@/components/ui/button";

interface ScanResultProps {
  result: ScanResult;
  onDismiss: () => void;
}

// Pill variants. NOTE: queued/error are deliberately NOT red — a network problem
// must never look like a rejected ticket, or staff will turn away valid holders.
const resultVariantMap: Record<
  ScanResultType,
  "success" | "warning" | "error" | "info"
> = {
  success: "success",
  already_used: "warning",
  wrong_scanner: "error",
  invalid: "error",
  queued: "info",
  error: "warning",
};

const ScanResultComponent = ({ result, onDismiss }: ScanResultProps) => {
  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center p-4 pb-12"
      onClick={onDismiss}
    >
      <div
        className={cn(
          "absolute inset-0 transition-colors",
          result.result === "success" && "bg-success/20",
          result.result === "already_used" && "bg-warning/20",
          result.result === "wrong_scanner" && "bg-wrong/20",
          result.result === "invalid" && "bg-error/20",
          result.result === "queued" && "bg-info/20",
          result.result === "error" && "bg-warning/20"
        )}
      />

      <div
        className={cn(
          "relative w-full max-w-sm rounded-2xl border-2 bg-white p-5 shadow-xl animate-in slide-in-from-bottom-4 duration-300",
          result.result === "success" && "border-success",
          result.result === "already_used" && "border-warning",
          result.result === "wrong_scanner" && "border-wrong",
          result.result === "invalid" && "border-error",
          result.result === "queued" && "border-info",
          result.result === "error" && "border-warning"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-3">
          <ResultIcon result={result.result} />
          <div className="flex flex-col gap-1">
            <Text variant="h5">
              <ResultTitle result={result.result} />
            </Text>
            <TagPill
              tag={result.result.replace("_", " ")}
              variant={resultVariantMap[result.result]}
              size="xs"
              showDot
            />
          </div>
        </div>

        <div className="space-y-2">
          {result.result === "success" && (
            <>
              <DetailRow label="Name" value={result.ticket.ownerName} />
              <DetailRow label="Ticket" value={result.ticket.ticketTypeName} />
              {result.ticket.seatInfo && (
                <DetailRow
                  label="Section"
                  value={String(result.ticket.seatInfo.section)}
                />
              )}
            </>
          )}

          {result.result === "already_used" && (
            <>
              <DetailRow label="Name" value={result.ticket.ownerName} />
              <DetailRow
                label="First scanned"
                value={formatTime(result.ticket.firstUsedAt)}
              />
            </>
          )}

          {result.result === "wrong_scanner" && (
            <>
              {result.correctScannerName && (
                <DetailRow
                  label="Correct entrance"
                  value={result.correctScannerName}
                />
              )}
              <Text variant="p2" color="secondary" className="mt-2">
                {result.message}
              </Text>
            </>
          )}

          {result.result === "invalid" && (
            <Text variant="p2" color="secondary">
              {result.message}
            </Text>
          )}

          {result.result === "queued" && (
            <Text variant="p2" color="secondary">
              Saved offline at {formatTime(result.capturedAt)}. It will be
              verified automatically when the connection returns.
            </Text>
          )}

          {result.result === "error" && (
            <Text variant="p2" color="secondary">
              {result.message}
            </Text>
          )}
        </div>

        <Button
          variant="secondary"
          size="md"
          onClick={onDismiss}
          className="mt-4 w-full"
        >
          Tap to scan next
        </Button>
      </div>
    </div>
  );
};

function ResultIcon({ result }: { result: ScanResultType }) {
  const iconClass = "h-8 w-8";
  switch (result) {
    case "success":
      return <CheckCircle2 className={cn(iconClass, "text-success")} />;
    case "already_used":
      return <AlertTriangle className={cn(iconClass, "text-warning")} />;
    case "wrong_scanner":
      return <ArrowRightLeft className={cn(iconClass, "text-wrong")} />;
    case "invalid":
      return <XCircle className={cn(iconClass, "text-error")} />;
    case "queued":
      return <CloudOff className={cn(iconClass, "text-info")} />;
    case "error":
      return <WifiOff className={cn(iconClass, "text-warning")} />;
  }
}

function ResultTitle({ result }: { result: ScanResultType }) {
  switch (result) {
    case "success":
      return "Valid Ticket";
    case "already_used":
      return "Already Used";
    case "wrong_scanner":
      return "Wrong Entrance";
    case "invalid":
      return "Invalid Ticket";
    case "queued":
      return "Queued — offline";
    case "error":
      return "Connection Problem";
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <Text variant="p2" color="secondary">
        {label}
      </Text>
      <Text variant="span2">{value}</Text>
    </div>
  );
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export default ScanResultComponent;
