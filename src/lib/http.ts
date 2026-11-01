import type { SourceStamp } from "./types";

const UA = "Dhruva/1.0 (+https://landfall-rho.vercel.app; supply-chain risk research; contact: rohithsuresh2107@gmail.com)";

interface CacheEntry {
  at: number;
  value: unknown;
  stamp: SourceStamp;
}
const cache = new Map<string, CacheEntry>();

export interface Fetched<T> {
  data: T | null;
  stamp: SourceStamp;
  error?: string;
}

interface Opts {
  id: string;
  name: string;
  ttlMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  as?: "json" | "text";
  method?: "GET" | "POST";
  body?: string;
  /** Pull the newest-observation timestamp out of the parsed payload. */
  observed?: (data: any) => string | undefined;
  /** Reject payloads that arrive as HTTP 200 but carry an error body (ArcGIS does this). Rejected payloads are never cached. */
  valid?: (data: any) => boolean;
  /** Extra attempts after a failure or rejected payload. */
  retries?: number;
  /** If every attempt fails, fall back to the last good payload when it is younger than this many ms. The stamp says so. */
  staleMs?: number;
}

const keyOf = (url: string, o: Opts) => (o.method ?? "GET") + " " + url + (o.body ?? "");

export async function fetchSource<T = any>(url: string, o: Opts): Promise<Fetched<T>> {
  let last = await fetchOnce<T>(url, o);
  for (let i = 0; i < (o.retries ?? 0) && !last.stamp.ok; i++) {
    await new Promise((r) => setTimeout(r, 700 * (i + 1) * (i + 1)));
    last = await fetchOnce<T>(url, o);
  }
  if (!last.stamp.ok && o.staleMs) {
    const old = cache.get(keyOf(url, o));
    if (old && Date.now() - old.at < o.staleMs) {
      const mins = Math.round((Date.now() - old.at) / 60_000);
      return { data: old.value as T, stamp: { ...old.stamp, note: `last good reading from ${mins} min ago; live refresh failed (${last.error ?? "error"})` } };
    }
  }
  return last;
}

async function fetchOnce<T = any>(url: string, o: Opts): Promise<Fetched<T>> {
  const key = keyOf(url, o);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < (o.ttlMs ?? 60_000)) {
    return { data: hit.value as T, stamp: { ...hit.stamp, note: "cached " + Math.round((now - hit.at) / 1000) + "s" } };
  }
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 9000);
  const baseStamp = { id: o.id, name: o.name, url, fetchedAt: new Date().toISOString() };
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      method: o.method ?? "GET",
      body: o.body,
      headers: { "User-Agent": UA, Accept: o.as === "text" ? "*/*" : "application/json", ...o.headers },
      cache: "no-store",
    });
    if (!res.ok) {
      const stamp: SourceStamp = { ...baseStamp, ok: false, ms: Date.now() - t0, note: `HTTP ${res.status}` };
      return { data: null, stamp, error: `HTTP ${res.status}` };
    }
    const data = (o.as === "text" ? await res.text() : await res.json()) as T;
    if (o.valid && !o.valid(data)) {
      const why = (data as any)?.error?.message ?? "unexpected payload";
      const stamp: SourceStamp = { ...baseStamp, ok: false, ms: Date.now() - t0, note: String(why) };
      return { data, stamp, error: String(why) };
    }
    const stamp: SourceStamp = {
      ...baseStamp,
      ok: true,
      ms: Date.now() - t0,
      observedAt: o.observed ? safe(() => o.observed!(data)) : undefined,
    };
    cache.set(key, { at: now, value: data, stamp });
    return { data, stamp };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "timeout" : String(e?.message ?? e);
    const stamp: SourceStamp = { ...baseStamp, ok: false, ms: Date.now() - t0, note: msg };
    return { data: null, stamp, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function safe<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}
