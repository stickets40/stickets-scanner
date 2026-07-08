import { NextRequest, NextResponse } from "next/server";
import {
  backendMessage,
  backendPost,
  clearTokenCookie,
  SCANNER_COOKIE,
} from "../_lib/backend";

export const dynamic = "force-dynamic";

/**
 * Proxy a scan to the backend, attaching the Bearer from the httpOnly cookie.
 * Accepts { payload, scanId? } — scanId makes an offline-queue replay idempotent
 * (see the queue in the client). Returns the unwrapped ScanServerResult on 200.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SCANNER_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { status, body: data } = await backendPost("scan", body, token);

  // Token rejected → clear the cookie so the client logs out cleanly.
  if (status === 401) {
    const res = NextResponse.json(
      { message: "Session expired" },
      { status: 401 }
    );
    clearTokenCookie(res);
    return res;
  }

  if (status < 200 || status >= 300) {
    return NextResponse.json(
      { message: backendMessage(data, "Scan failed") },
      { status }
    );
  }

  // Backend wraps as { success, data: ScanServerResult } — unwrap to the result.
  const envelope = data as { data?: unknown } | null;
  return NextResponse.json(envelope?.data ?? data, { status: 200 });
}
