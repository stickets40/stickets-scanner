import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Presence check on the httpOnly token cookie set by the BFF on login. This
  // only gates which SHELL renders — every real scan is re-authorized server-side
  // by the backend (HS256 pin + type:'scanner' claim + live is_active check), so
  // a forged cookie renders nothing useful.
  const hasToken = request.cookies.get("scanner-token")?.value;

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // No token + protected path → redirect to login
  if (!hasToken && !isPublicPath) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Has token + login page → redirect to scan
  if (hasToken && pathname === "/login") {
    return NextResponse.redirect(new URL("/scan", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Exclude the BFF API routes (they handle their own auth — the login routes
  // must be reachable while unauthenticated), Next internals, PWA assets, the
  // service worker, and the manifest (served at /manifest.webmanifest).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icons|sw.js|manifest.webmanifest).*)",
  ],
};
