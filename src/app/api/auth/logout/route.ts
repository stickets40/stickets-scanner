import { NextResponse } from "next/server";
import { clearTokenCookie } from "../../_lib/backend";

export const dynamic = "force-dynamic";

/** Clear the scanner token cookie. (Server-side revocation is organizer-side.) */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearTokenCookie(res);
  return res;
}
