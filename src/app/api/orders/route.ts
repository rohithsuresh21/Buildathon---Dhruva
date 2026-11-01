import { OrderInput, newOrder, seal, sendConfirmation } from "@/lib/orders";

export const maxDuration = 20;
export const dynamic = "force-dynamic";

/**
 * POST /api/orders
 * Seals a booking the customer has reviewed and approved. Nothing is stored: the booking lives in the returned link.
 */
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = OrderInput.safeParse(await req.json());
  } catch {
    return Response.json({ error: "Send the booking as JSON." }, { status: 400 });
  }
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Response.json({ error: `Check “${first.path.join(" › ")}”: ${first.message}` }, { status: 400 });
  }
  const input = parsed.data;
  const when = Date.parse(input.handover.at + ":00Z");
  const nowLocalish = Date.now() - 24 * 3600_000; // the slot is in the agency's own time, so allow a day of slack either way
  if (!Number.isFinite(when) || when < nowLocalish || when > Date.now() + 90 * 24 * 3600_000) {
    return Response.json({ error: "Pick a hand-over time within the next 90 days." }, { status: 400 });
  }
  let token: string;
  const order = newOrder(input);
  try {
    token = seal(order);
  } catch {
    return Response.json({ error: "Booking is not configured on this server yet." }, { status: 503 });
  }
  const origin = new URL(req.url).origin;
  const link = `${origin}/order/${token}`;
  const emailed = await sendConfirmation(order, link);
  return Response.json({ id: order.id, token, url: `/order/${token}`, emailed });
}
