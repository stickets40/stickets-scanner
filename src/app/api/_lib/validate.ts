import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { bffError } from "./backend";

export const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
export const BASE58_TOKEN_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Parse + validate a JSON body; a failure is a 400 BAD_REQUEST the client never retries. */
export async function readJson<T>(
  req: NextRequest,
  schema: ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
    return { ok: false, res: bffError(400, `${where}${first?.message ?? "Invalid request"}`, "BAD_REQUEST") };
  }
  return { ok: true, data: parsed.data };
}

export function readQuery<T>(
  req: NextRequest,
  schema: ZodType<T>
): { ok: true; data: T } | { ok: false; res: NextResponse } {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    obj[key] = value;
  });
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
    return { ok: false, res: bffError(400, `${where}${first?.message ?? "Invalid query"}`, "BAD_REQUEST") };
  }
  return { ok: true, data: parsed.data };
}

/** Header first, body second — the client sends both. */
export function deviceIdOf(req: NextRequest, body?: { deviceId?: string }): string | undefined {
  const header = req.headers.get("x-device-id")?.trim();
  if (header && DEVICE_ID_RE.test(header)) return header;
  const fromBody = body?.deviceId?.trim();
  return fromBody && DEVICE_ID_RE.test(fromBody) ? fromBody : undefined;
}
