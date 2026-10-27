import { NextResponse } from "next/server";
import { platformState } from "@/lib/platform";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { "cache-control": "no-store, max-age=0", ...(init?.headers ?? {}) },
  });
}

export function fail(message: string, status = 400) {
  return json({ error: message }, { status });
}

/** Every read endpoint requires a materialised platform. */
export async function requirePlatform() {
  try {
    const state = await platformState();
    if (!state.bootstrapped) {
      return {
        state,
        response: json({ error: "PLATFORM_NOT_BOOTSTRAPPED", hint: "POST /api/bootstrap to run the end-to-end pipeline." }, { status: 409 }),
      };
    }
    return { state, response: null };
  } catch (e) {
    return {
      state: null,
      response: json({ error: e instanceof Error ? e.message : "database unavailable" }, { status: 500 }),
    };
  }
}

export function numParam(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function strParam(url: URL, key: string): string | undefined {
  const raw = url.searchParams.get(key);
  return raw && raw !== "all" ? raw : undefined;
}
