import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];
const TOKEN_COOKIE = "scanner-token";
const HINT_COOKIE = "scanner-session-hint";

/**
 * Shell gating only — every real call is re-authorised by the backend.
 *
 * A device whose token EXPIRED mid-shift must still be able to open the
 * (cached) scanner shell: it may be offline with a queue to protect, and the
 * inline re-auth sheet lives inside the shell. So the presence of EITHER the
 * token or the long-lived hint cookie lets a protected path through; only a
 * device that has never signed in is sent to /login. The login page bounces
 * to /scan only while a real token exists.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasToken = !!request.cookies.get(TOKEN_COOKIE)?.value;
  const hasHint = !!request.cookies.get(HINT_COOKIE)?.value;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasToken && !hasHint && !isPublicPath) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasToken && pathname === "/login") {
    return NextResponse.redirect(new URL("/scan", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Exclude the BFF API routes (they handle their own auth), Next internals,
  // PWA assets, the service worker, the manifest and the monitoring tunnel.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icons|zxing|sw.js|manifest.webmanifest|monitoring).*)",
  ],
};
