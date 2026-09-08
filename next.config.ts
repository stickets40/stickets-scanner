import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Defense-in-depth CSP. The primary token protection is now the httpOnly cookie
// (the token is no longer in client JS), so this is a hardening layer. All
// backend traffic is same-origin (the BFF proxies server-side), so connect-src
// only needs 'self'. Dev adds 'unsafe-eval' + ws: for Turbopack/HMR.
const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval': the self-hosted ZXing decoder is WebAssembly.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isProd ? "" : " ws:"}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  // Camera app: allow camera to self only; block the rest.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=()",
  },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

// One id per deploy: names the service-worker cache, shows in diagnostics,
// and lets a device tell "my shell is from an older deploy" apart from a bug.
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
  process.env.SCANNER_BUILD_ID ??
  `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  generateBuildId: () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // Strip console.* (except warn/error) from production bundles.
  compiler: isProd ? { removeConsole: { exclude: ["error", "warn"] } } : {},
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
