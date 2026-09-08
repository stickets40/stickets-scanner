import { NextResponse, type NextRequest } from "next/server";
import { bffError } from "../_lib/backend";
import { scrubTelemetry, TELEMETRY_MAX_BYTES } from "../_lib/telemetry";

export const dynamic = "force-dynamic";

/**
 * Device telemetry sink: camera failures, queue stalls, storage problems,
 * client errors. Logged server-side as one structured line per beacon; wire
 * an APM/Sentry forwarder here when one is provisioned. Bodies are capped and
 * scrubbed; the route is deliberately unauthenticated (a device with an
 * expired session is exactly the one that needs to report).
 */
export async function POST(req: NextRequest) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > TELEMETRY_MAX_BYTES) return bffError(413, "Telemetry too large", "TOO_LARGE");
  const text = await req.text().catch(() => "");
  if (text.length > TELEMETRY_MAX_BYTES) return bffError(413, "Telemetry too large", "TOO_LARGE");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return bffError(400, "Invalid JSON", "BAD_REQUEST");
  }
  const scrubbed = scrubTelemetry(body);
  console.warn("[scanner-telemetry]", JSON.stringify({ at: new Date().toISOString(), ...(scrubbed as object) }));
  return new NextResponse(null, { status: 204 });
}
