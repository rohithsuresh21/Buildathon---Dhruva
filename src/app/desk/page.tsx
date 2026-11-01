import type { Metadata } from "next";
import Desk from "@/components/Desk";

export const metadata: Metadata = { title: "Desk — Dhruva", description: "Pick where a shipment starts and ends. Dhruva's agents check live sources along the route and tell you whether it is likely to be disrupted." };

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ q?: string; d?: string }> }) {
  const { q, d } = await searchParams;
  return <Desk initialQ={q} initialD={d} />;
}
