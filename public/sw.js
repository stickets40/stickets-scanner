/* Stickets Scanner service worker.
 *
 * Registered as /sw.js?v=<buildId>, so every deploy is a NEW worker with its
 * own cache. It never calls skipWaiting() on its own: a new version waits
 * until the operator taps "Reload" between holders (the app posts
 * SKIP_WAITING). Auth and scan requests (/api/*) are NEVER cached.
 *
 * PRECACHE_SHELL (posted after login and on every /scan mount) fetches the
 * pages the gate needs and their static chunks so a later OFFLINE launch —
 * even with an expired session — still serves the camera shell.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `stickets-scanner-${VERSION}`;
const SHELL_PAGES = ["/scan", "/login", "/settings"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/icons/icon-192x192.png", "/icons/icon-512x512.png", "/icons/logo.png", "/zxing/zxing_reader.wasm"]).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "PRECACHE_SHELL") {
    event.waitUntil(precacheShell());
  }
});

async function precacheShell() {
  const cache = await caches.open(CACHE);
  const chunkUrls = new Set();
  for (const path of SHELL_PAGES) {
    try {
      // redirect: "manual" — a redirected response (e.g. /scan → /login for an
      // unknown device) must not be cached under the requested path.
      const res = await fetch(path, { credentials: "same-origin", redirect: "manual", cache: "no-store" });
      if (res.type === "opaqueredirect" || !res.ok) continue;
      const copy = res.clone();
      await cache.put(path, res);
      const html = await copy.text();
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) chunkUrls.add(m[1]);
    } catch {
      /* offline — keep what we have */
    }
  }
  for (const url of chunkUrls) {
    try {
      const hit = await cache.match(url);
      if (!hit) await cache.add(url);
    } catch {
      /* a single chunk failing must not abort the rest */
    }
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/monitoring") || url.pathname === "/sw.js") return;

  // Hashed static assets: cache-first (immutable per build).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.status === 200) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
      )
    );
    return;
  }

  // Navigations: network first with a 3 s race, then the cached page, then /scan.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
        try {
          const res = await Promise.race([fetch(req), timeout]);
          if (res && res.ok && res.type !== "opaqueredirect") {
            cache.put(url.pathname, res.clone());
            return res;
          }
          if (res) return res;
        } catch {
          /* offline */
        }
        return (await cache.match(url.pathname)) || (await cache.match("/scan")) || Response.error();
      })()
    );
    return;
  }

  // Everything else (icons, manifest, fonts): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
