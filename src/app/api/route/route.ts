import { plan } from "@/lib/agents/planner";
import { buildParsed, type Structured } from "@/lib/agents/structured";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Route preview for the globe: the same planner the agents use, without the hazard checks. */
export async function POST(req: Request) {
  let body: Structured;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { message: "Send JSON with from, to and mode." } }, { status: 400 });
  }
  const b = buildParsed(body);
  if (!b.parsed) return Response.json({ error: b.error }, { status: 400 });
  try {
    const pl = await plan(b.parsed);
    if ("error" in pl) return Response.json({ error: pl.error }, { status: 422 });
    return Response.json(
      { parsed: b.parsed, itineraries: pl.itineraries, primary: pl.primary, notes: pl.notes },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return Response.json({ error: { message: "The route could not be drawn.", hint: String(e?.message ?? e).slice(0, 160) } }, { status: 500 });
  }
}
