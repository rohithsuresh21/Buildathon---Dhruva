import { fetchSource } from "../http";
import type { SourceStamp } from "../types";

export interface Headline {
  title: string;
  url: string;
  domain: string;
  seen: string;
}

const DISRUPT = /(clos(e|ed|ure)|block(ade|ed)|attack|strike|suspend|halt|congest|delay|divert|reroute|storm|cyclone|typhoon|flood|fire|explosion|shutdown|embargo|sanction|mine|missile|drone|hijack|piracy)/i;

/** GDELT DOC 2.0 article list for a maritime or place query, last 3 days. Slow and rate-limited, so it is best-effort. */
export async function getHeadlines(query: string): Promise<{ list: Headline[]; hits: number; stamp: SourceStamp }> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${query} sourcelang:english`)}&mode=artlist&maxrecords=15&format=json&timespan=3d&sort=datedesc`;
  const r = await fetchSource<any>(url, { id: "gdelt", name: "GDELT global news index", ttlMs: 20 * 60_000, timeoutMs: 7000 });
  const arts: any[] = r.data?.articles ?? [];
  const list: Headline[] = arts
    .filter((a) => DISRUPT.test(a.title ?? ""))
    .slice(0, 5)
    .map((a) => ({ title: String(a.title), url: a.url, domain: a.domain, seen: a.seendate }));
  return { list, hits: list.length, stamp: { ...r.stamp, observedAt: arts[0]?.seendate ? gdeltDate(arts[0].seendate) : undefined } };
}

function gdeltDate(s: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : undefined;
}
