import { analyze } from "@/lib/agents/orchestrator";
import { buildParsed } from "@/lib/agents/structured";
import type { StreamEvent } from "@/lib/analysis-types";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let text = "";
  let deep = false;
  let pre: ReturnType<typeof buildParsed>["parsed"];
  try {
    const body = await req.json();
    deep = body?.deep === true;
    if (body?.shipment) {
      const b = buildParsed(body.shipment);
      if (!b.parsed) return Response.json({ error: b.error }, { status: 400 });
      pre = b.parsed;
      text = pre.raw;
    } else text = String(body?.text ?? "");
  } catch {
    return Response.json({ error: "Send JSON like {\"text\": \"Solar inverters from Shenzhen to Mundra\"}" }, { status: 400 });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await analyze(text, send, pre, { deep });
      } catch (e: any) {
        send({ type: "error", message: "The analysis stopped unexpectedly.", hint: String(e?.message ?? e).slice(0, 200) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
