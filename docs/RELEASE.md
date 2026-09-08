# Scanner release notes — free events & production gate (2026-09)

## Deploy order (backend before clients)

1. **Backend** (`stickets-backend`, migrations `1786600000003` + `1786600000004`). Env: `SCANNER_JWT_SECRET` (≥ 32 chars, ≠ `JWT_SECRET`), `INTERNAL_API_KEY`, `K_MASTER` (never rotate — it derives the QR v3 signing keys and the on-chain commitments), `QR_ACCEPT_V2=true` for the grace period, `PAYMENTS_ENABLED` unset/false until a payment provider ships, and the scanner's public origin in `ALLOWED_ORIGINS`.
2. **Web + mobile** (tolerant `/tickets/qr` parsing, `payments_enabled`, entry instructions). Bust the event cache so ISR payloads carry `payments_enabled`.
3. **Scanner** (this app). Vercel/host env: `SCANNER_BACKEND_URL` (…/api/scanner), `INTERNAL_API_KEY` (same value as the backend), `SCANNER_PUBLIC_ORIGIN`, optional `SCANNER_BUILD_ID`, `NEXT_PUBLIC_OFFLINE_VALIDATION=1`. `npm install`/`build` copy the ZXing decoder into `public/zxing` (self-hosted; the CSP blocks the CDN and venues have no internet).

## What changed for operators

- Every verdict fills the screen; **offline** verdicts are tagged. Outside the scan window (default doors − 3 h … doors + 2 h, organizer override in Entry management) the ticket is refused and **not consumed**.
- **Undo** within 5 minutes, same account + device, from the verdict card or the shift log.
- **Lookup** (magnifier) searches holder name / email prefix and checks in through the same atomic path; offline it is read-only.
- A lost connection is not a rejected ticket: the device verifies against its offline data (synced at login, then every minute) and syncs admissions when back. Unknown-but-genuine codes ask the operator: Try online / Admit unverified / Deny.
- An expired or reset session shows an inline sign-in sheet; scanning continues from offline data meanwhile.
- New deploys wait for the operator ("Update available — Reload"); a mid-shift reload never happens on its own.

## Behaviour changes to announce

- Paid ticket types show "Sales open soon" until `PAYMENTS_ENABLED=true`.
- `GET /api/scanner/auth/validate` was removed; scanner auth failures are always **401** with a `code`.
- Credential resets and deactivation now end live scanner sessions immediately.
- Scanner login limits are per client IP and per credential (not per BFF egress IP).

## Grace period (suggest 30 days after the mobile release is widely adopted)

Set `QR_ACCEPT_V2=false`; drop the legacy `payload` / `version` / `zoom_link` keys from `/tickets/qr`; remove `tryDecryptQRPayload` / `encryptQRPayload` and the legacy branches in the web and mobile QR normalisers. The on-chain commitment derivation in `qrCode.util.ts` stays forever.

## Ops

- First ask on any door report: Settings → **Export diagnostics** (build, device id, connectivity, session, offline-data age, queue counts, recent telemetry).
- Watch backend logs for `offline verdict mismatch`, `SCAN_ID_CONFLICT`, `LEGACY_FORMAT_REJECTED`, and `NOT_A_TICKET` bursts per device; scanner telemetry (`[scanner-telemetry]` lines from `/api/telemetry`) for `camera_error`, `idb_unavailable`, `manifest_sync_failed`, `offline_admission_rejected`. Forward these to an APM/Sentry from the telemetry route when one is provisioned.
- IndexedDB v2 → v3 migration is one-way; test on a device holding pending v2 records before the first production install.
- Accepted risk: the offline manifest holds attendee display names on staff devices; it is wiped on sign-out when nothing is left to sync.
