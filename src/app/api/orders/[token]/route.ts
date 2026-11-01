import { ics, open } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** GET /api/orders/:token returns the booking as a calendar event (.ics). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const order = open(decodeURIComponent(token));
  if (!order) return new Response("Not found", { status: 404 });
  return new Response(ics(order), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${order.id}.ics"`, "Cache-Control": "no-store" },
  });
}
