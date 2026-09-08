import { NextResponse } from "next/server";
import { clearSessionCookies } from "../../_lib/session";

export const dynamic = "force-dynamic";

/** Clear both cookies. (Server-side revocation is organizer-side.) */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
