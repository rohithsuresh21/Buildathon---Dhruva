import { XMLParser } from "fast-xml-parser";
import { fetchSource } from "../http";
import type { SourceStamp } from "../types";

export const SACHET_RSS = "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml";
const CAP = "https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=";

const xml = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, trimValues: true });

export interface SachetItem {
  id: string;
  title: string;
  link: string;
  published: string;
}

export interface SachetAlert extends SachetItem {
  event?: string;
  severity?: "Minor" | "Moderate" | "Severe" | "Extreme" | "Unknown";
  urgency?: string;
  area?: string;
  expires?: string;
  sender?: string;
}

export async function getSachetFeed(): Promise<{ items: SachetItem[]; stamp: SourceStamp }> {
  const r = await fetchSource<string>(SACHET_RSS, {
    id: "sachet-rss",
    name: "NDMA Sachet CAP alert feed (India)",
    as: "text",
    ttlMs: 3 * 60_000,
    timeoutMs: 12_000,
    headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
    observed: (t) => {
      const m = /<pubDate>([^<]+)<\/pubDate>/.exec(t);
      return m ? new Date(m[1]).toISOString() : undefined;
    },
  });
  if (!r.data) return { items: [], stamp: r.stamp };
  try {
    const j = xml.parse(r.data);
    const raw = j?.rss?.channel?.item ?? [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const items: SachetItem[] = arr
      .map((x: any) => {
        const link = String(x.link ?? "");
        return {
          id: link.split("identifier=")[1] ?? link,
          title: String(x.title ?? "").trim(),
          link,
          published: x.pubDate ? new Date(x.pubDate).toISOString() : "",
        };
      })
      .filter((x: SachetItem) => x.title && x.published);
    return { items, stamp: { ...r.stamp, observedAt: items[0]?.published ?? r.stamp.observedAt } };
  } catch (e: any) {
    return { items: [], stamp: { ...r.stamp, ok: false, note: "parse error: " + e?.message } };
  }
}

export async function getCap(item: SachetItem): Promise<SachetAlert> {
  const r = await fetchSource<string>(CAP + item.id, { id: "sachet-cap", name: "NDMA Sachet CAP message", as: "text", ttlMs: 30 * 60_000, timeoutMs: 8000 });
  if (!r.data) return { ...item };
  try {
    const j = xml.parse(r.data);
    const info = Array.isArray(j?.alert?.info) ? j.alert.info[0] : j?.alert?.info;
    const area = Array.isArray(info?.area) ? info.area[0] : info?.area;
    return {
      ...item,
      event: info?.event ? String(info.event) : undefined,
      severity: info?.severity ?? "Unknown",
      urgency: info?.urgency,
      area: area?.areaDesc ? String(area.areaDesc) : undefined,
      expires: info?.expires ? new Date(info.expires).toISOString() : undefined,
      sender: j?.alert?.sender,
    };
  } catch {
    return { ...item };
  }
}

/** Event words that matter to cargo movement. Local thunderstorm or lightning nowcasts are ignored unless Severe. */
export const CARGO_EVENT = /cyclon|flood|rain|surge|tsunami|tide|wave|swell|wind|gale|storm|landslide|fog|snow|cloudburst|earthquake|high sea|fishermen/i;

export function sachetSeverity(a: SachetAlert): 0 | 1 | 2 | 3 {
  const ev = `${a.event ?? ""} ${a.title}`;
  if (/thunder|lightning|lightening/i.test(ev) && !/(severe|extreme)/i.test(a.severity ?? "")) return 0;
  if (a.severity === "Extreme" || a.severity === "Severe") return 3;
  if (a.severity === "Moderate") return 2;
  if (a.severity === "Minor") return 1;
  return 1;
}
