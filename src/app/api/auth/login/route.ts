import { NextRequest, NextResponse } from "next/server";
import {
  backendMessage,
  backendPost,
  setTokenCookie,
} from "../../_lib/backend";

export const dynamic = "force-dynamic";

/** Account login (username/password) → sets httpOnly token cookie, returns profile. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { status, body: data } = await backendPost("auth/login", body);

  const envelope = data as
    | { data?: { accessToken?: string; scanner?: unknown } }
    | null;
  const accessToken = envelope?.data?.accessToken;
  const scanner = envelope?.data?.scanner;

  if (status < 200 || status >= 300 || !accessToken) {
    return NextResponse.json(
      { message: backendMessage(data, "Invalid credentials") },
      { status: status >= 400 ? status : 401 }
    );
  }

  const res = NextResponse.json({ scanner });
  setTokenCookie(res, accessToken);
  return res;
}
