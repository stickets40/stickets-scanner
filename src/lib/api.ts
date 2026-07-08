import ky from "ky";
import { useAuthStore } from "@/stores/auth.store";

/**
 * Client HTTP layer. Calls the scanner's OWN same-origin BFF routes (/api/*),
 * NOT the backend directly — the scanner JWT is an httpOnly cookie the browser
 * attaches automatically, so no token is ever handled in client JS.
 */
export const api = ky.create({
  prefixUrl: "/api",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000,
  retry: {
    // GET only; the scan POST's resilience is handled by the offline queue
    // (idempotent by scanId), not blind ky retries.
    limit: 1,
    methods: ["get"],
    statusCodes: [408, 500, 502, 503, 504],
  },
  hooks: {
    afterResponse: [
      (_request, _options, response) => {
        // The BFF returns 401 (and clears the cookie) when the session is gone.
        if (response.status === 401 && typeof window !== "undefined") {
          useAuthStore.getState().logout();
          if (!window.location.pathname.startsWith("/login")) {
            window.location.href = "/login";
          }
        }
      },
    ],
  },
});
