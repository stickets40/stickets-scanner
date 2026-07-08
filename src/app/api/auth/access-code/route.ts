import { NextRequest, NextResponse } from "next/server";
import {
  backendMessage,
  backendPost,
  setTokenCookie,
} from "../../_lib/backend";

export const dynamic = "force-dynamic";

/** Access-code login → sets httpOnly token cookie, returns profile (no token). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { status, body: data } = await backendPost("auth/access-code", body);

  const envelope = data as
    | { data?: { accessToken?: string; scanner?: unknown } }
    | null;
  const accessToken = envelope?.data?.accessToken;
  const scanner = envelope?.data?.scanner;

  if (status < 200 || status >= 300 || !accessToken) {
    return NextResponse.json(
      { message: backendMessage(data, "Invalid access code") },
      { status: status >= 400 ? status : 401 }
    );
  }

  const res = NextResponse.json({ scanner });
  setTokenCookie(res, accessToken);
  return res;
}
