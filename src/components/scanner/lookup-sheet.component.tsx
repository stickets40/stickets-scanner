"use client";

import { useEffect, useRef, useState } from "react";
import { Search, WifiOff } from "lucide-react";
import { api, describeFailure } from "@/lib/api";
import { searchManifestByName, type ManifestRow } from "@/lib/manifest";
import { useSessionStore } from "@/stores/session.store";
import { attendeesResponseSchema, parseServerVerdict, type AttendeeMatch, type ServerVerdict } from "@/types/verdict.types";
import Sheet from "@/components/ui/sheet";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import { TagPill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";

interface LookupSheetProps {
  open: boolean;
  onClose: () => void;
  onCheckedIn: (scanId: string, verdict: ServerVerdict) => void;
}

type Row =
  | { source: "server"; match: AttendeeMatch }
  | { source: "offline"; row: ManifestRow };

/**
 * Manual lookup: the fallback for a torn ticket, a dead phone or a dead camera.
 * Online → the server search (masked email, live status) and a manual
 * check-in through the SAME atomic path as a scan. Offline → read-only search
 * of the device manifest, with "reconnect to admit" — an unverified admit from
 * a name alone is not something this app will do.
 */
const LookupSheetComponent = ({ open, onClose, onCheckedIn }: LookupSheetProps) => {
  const connectivity = useSessionStore((s) => s.connectivity);
  const auth = useSessionStore((s) => s.auth);
  const online = connectivity === "online" && auth !== "reauth_required";
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AttendeeMatch | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setRows([]);
      setError(null);
      setConfirming(null);
      setNote("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setRows([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        if (online) {
          const r = await api.get("attendees", { searchParams: { q: term }, timeoutMs: 6000 });
          if (r.ok) {
            const parsed = attendeesResponseSchema.safeParse(r.data);
            setRows(parsed.success ? parsed.data.items.map((match) => ({ source: "server", match })) : []);
          } else if (r.status === 401) {
            setRows((await searchManifestByName(term)).map((row) => ({ source: "offline", row })));
          } else {
            setError(describeFailure(r, "Search failed."));
          }
        } else {
          setRows((await searchManifestByName(term)).map((row) => ({ source: "offline", row })));
        }
      } catch {
        setError("Search failed.");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, online, open]);

  const checkIn = async () => {
    if (!confirming) return;
    setSubmitting(true);
    setError(null);
    const scanId = crypto.randomUUID();
    const r = await api.post("scan/manual", { tokenId: confirming.tokenId, scanId, note: note.trim() || undefined }, { timeoutMs: 8000 });
    setSubmitting(false);
    if (!r.ok) {
      setError(describeFailure(r, "Check-in failed."));
      return;
    }
    try {
      const verdict = parseServerVerdict(r.data);
      onClose();
      onCheckedIn(scanId, verdict);
    } catch {
      setError("Unexpected answer from the server.");
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Look up a ticket"
      description={online ? "Search by holder name or the start of their email." : "Offline: search this device's data. Reconnect to check anyone in."}
    >
      <div className="space-y-4">
        {!online && (
          <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            Read-only while offline — a manual check-in needs the server.
          </p>
        )}
        <Input
          ref={inputRef}
          label="Name or email"
          placeholder="e.g. Nino or nino@"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="search"
          startContent={<Search className="h-4 w-4" aria-hidden="true" />}
          error={error ?? undefined}
          helperText={error ? undefined : searching ? "Searching…" : q.trim().length > 0 && q.trim().length < 2 ? "Type at least 2 characters." : undefined}
        />

        {confirming ? (
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <p className="text-base font-semibold text-ink">{confirming.ownerName}</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {confirming.ticketTypeName}
              {confirming.emailMasked ? ` · ${confirming.emailMasked}` : ""}
            </p>
            <Input
              label="Note (optional)"
              placeholder="e.g. ID checked, phone dead"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 140))}
              containerClassName="mt-3"
            />
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirming(null)} disabled={submitting}>
                Back
              </Button>
              <Button className="flex-1" onClick={checkIn} isLoading={submitting} loadingText="Checking in…">
                Check in
              </Button>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((r) => {
              if (r.source === "server") {
                const m = r.match;
                const usable = m.status === "idle" || m.status === "activated";
                return (
                  <li key={m.tokenId} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{m.ownerName}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {m.ticketTypeName}
                        {m.emailMasked ? ` · ${m.emailMasked}` : ""}
                        {!m.scannableHere ? " · other entrance" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <TagPill tag={statusLabel(m.status)} variant={m.status === "used" ? "used" : usable ? "admit" : "pending"} size="xs" />
                      <button
                        type="button"
                        disabled={!usable || !m.scannableHere}
                        onClick={() => setConfirming(m)}
                        className={cn(
                          "min-h-10 rounded-xl px-3 text-sm font-semibold transition-colors",
                          usable && m.scannableHere ? "bg-brand text-white active:bg-brand/80" : "bg-surface-2 text-ink-faint"
                        )}
                      >
                        Check in
                      </button>
                    </div>
                  </li>
                );
              }
              const row = r.row;
              return (
                <li key={row.h} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{row.n || "Unknown"}</p>
                    <p className="truncate text-xs text-ink-muted">Type #{row.tt} · offline data</p>
                  </div>
                  <TagPill tag={row.s === "used" || row.localUsedAt ? "Used" : "Valid"} variant={row.s === "used" || row.localUsedAt ? "used" : "admit"} size="xs" />
                </li>
              );
            })}
            {rows.length === 0 && q.trim().length >= 2 && !searching && !error && (
              <li className="rounded-xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-muted">No matching tickets for this event.</li>
            )}
          </ul>
        )}
      </div>
    </Sheet>
  );
};

function statusLabel(status: string): string {
  switch (status) {
    case "used":
      return "Used";
    case "idle":
    case "activated":
      return "Valid";
    case "reselling":
    case "gifting":
      return "In transfer";
    default:
      return status;
  }
}

export default LookupSheetComponent;
