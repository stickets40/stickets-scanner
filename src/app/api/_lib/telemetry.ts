export const TELEMETRY_MAX_BYTES = 8 * 1024;
const STRIPPED_KEYS = new Set(["payload", "accessCode", "password", "token", "accessToken"]);

/** Never let a QR payload or a credential into the logs, however deep it sits. */
export function scrubTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubTelemetry(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (STRIPPED_KEYS.has(key)) continue;
      out[key] = scrubTelemetry(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  return value;
}
