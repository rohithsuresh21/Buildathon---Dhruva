import { judge, VERDICT_RANK, type Reading } from "../judge";
import { safetyOf, switchConfidence } from "../safety";
import { compose, actionFor, LANGS, type Lang } from "../compose";
import { parseShipment } from "./intake";
import { plan } from "./planner";
import { Shared, maritime, storm, alerts, aviation, surface, news, FAMILIES_BY_MODE, type Emit } from "./signals";
import type { Alternative, FinalAnswer, ParsedShipment, StreamEvent } from "../analysis-types";
import type { Itinerary, Leg, LegVerdict, Signal, SourceStamp, Verdict } from "../types";

type Send = (e: StreamEvent) => void;

const V_WORD: Record<Verdict, string> = { green: "Green", amber: "Amber", red: "Red", abstain: "Can't tell" };

function legReadings(signals: Signal[]): Reading[] {
  return signals.map((s) => ({
    family: s.family,
    severity: s.severity,
    confidence: s.confidence,
    fresh: (s.data as any)?.fresh !== false && s.sources.some((x) => x.ok),
    label: s.title,
  }));
}

function verdictForLeg(leg: Leg, signals: Signal[]): LegVerdict {
  const j = judge(legReadings(signals.filter((s) => s.legId === leg.id)), FAMILIES_BY_MODE[leg.mode]);
  return { legId: leg.id, verdict: j.verdict, confidence: j.confidence, reasons: j.reasons, families: j.flaggedFamilies };
}

function rollUp(legs: LegVerdict[]): { verdict: Verdict; confidence: number; worst?: LegVerdict } {
  const live = legs.filter((l) => l.verdict !== "abstain");
  if (!live.length) return { verdict: "abstain", confidence: 0 };
  const worst = live.reduce((a, b) => (VERDICT_RANK[b.verdict] > VERDICT_RANK[a.verdict] || (b.verdict === a.verdict && b.confidence > a.confidence) ? b : a));
  const abstained = legs.length - live.length;
  return { verdict: worst.verdict, confidence: abstained ? Math.min(worst.confidence, 0.5) : worst.confidence, worst };
}

function itinVerdict(it: Itinerary, lv: LegVerdict[]) {
  return rollUp(it.legs.map((l) => lv.find((x) => x.legId === l.id)!).filter(Boolean));
}

const todayZ = () => new Date().toISOString().slice(0, 16).replace("T", " ");

async function llmNarrative(facts: string, signal: AbortSignal): Promise<{ headline: string; summary: string } | null> {
  if (!process.env.VERCEL && !process.env.AI_GATEWAY_API_KEY) return null;
  try {
    const { generateText } = await import("ai");
    const { text } = await generateText({
      model: "anthropic/claude-haiku-4.5",
      abortSignal: signal,
      temperature: 0.2,
      maxOutputTokens: 300,
      system:
        "You write two plain-English sentences for a small exporter or importer who is not a logistics expert. Use ONLY the facts supplied. Do not add numbers, places, causes or advice that are not in the facts. Never say a shipment is delayed; say what the evidence shows. Output JSON: {\"headline\": string (max 14 words), \"summary\": string (max 60 words)}.",
      prompt: facts,
    });
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (typeof j.headline !== "string" || typeof j.summary !== "string") return null;
    // Guard: every number in the output must appear in the facts.
    const nums = (j.headline + " " + j.summary).match(/\d+(\.\d+)?/g) ?? [];
    if (nums.some((n) => !facts.includes(n))) return null;
    return { headline: j.headline.trim(), summary: j.summary.trim() };
  } catch {
    return null;
  }
}

export async function analyze(text: string, send: Send, pre?: ParsedShipment, opts: { deep?: boolean } = {}): Promise<void> {
  const deep = !!opts.deep;
  const t0 = Date.now();
  let usedLlm = false;
  const seen = new Set<string>();
  const emit: Emit = (e) => {
    const k = `${e.agent}|${e.stage}|${e.status}|${e.text}`;
    if (seen.has(k)) return;
    seen.add(k);
    send({ type: "trace", t: Date.now() - t0, ...e });
  };
  const sh = new Shared();

  // 1 ── intake
  emit({ agent: "intake", stage: 1, status: "start", text: "Reading your sentence" });
  const pr = pre ? ({ parsed: pre, stamps: [] } as Awaited<ReturnType<typeof parseShipment>>) : await parseShipment(text);
  if (!pr.parsed) {
    emit({ agent: "intake", stage: 1, status: "fail", text: pr.error!.message });
    send({ type: "error", message: pr.error!.message, hint: pr.error!.hint });
    return;
  }
  const parsed = pr.parsed;
  send({ type: "parsed", data: parsed });
  emit({
    agent: "intake", stage: 1, status: "ok",
    text: `Cargo “${parsed.cargo}”, from ${parsed.origin.name.split(" (")[0]} (${parsed.origin.country}) to ${parsed.destination.name.split(" (")[0]} (${parsed.destination.country})${parsed.modeHint !== "auto" ? `, by ${parsed.modeHint}` : ""}.`,
    source: pr.stamps[0],
  });

  // 2 ── planner
  emit({ agent: "planner", stage: 2, status: "start", text: deep ? "Searching wider for safer routings: other ports, every chokepoint avoided, air" : "Resolving lanes: ports, airports, rail corridors and roads" });
  const pl = await plan(parsed, { deep });
  if ("error" in pl) {
    emit({ agent: "planner", stage: 2, status: "fail", text: pl.error.message });
    send({ type: "error", message: pl.error.message, hint: pl.error.hint });
    return;
  }
  send({ type: "plan", data: { itineraries: pl.itineraries, primary: pl.primary } });
  for (const s of pl.stamps.slice(0, 1)) emit({ agent: "planner", stage: 2, status: "progress", text: "Road geometry from OpenStreetMap.", source: s });
  emit({
    agent: "planner", stage: 2, status: pl.notes.length ? "warn" : "ok",
    text: `${pl.itineraries.length} routing${pl.itineraries.length > 1 ? "s" : ""} built: ${pl.itineraries.map((i) => `${i.label} (${Math.round(i.km).toLocaleString("en-IN")} km)`).join("; ")}.${pl.notes.length ? " " + pl.notes.join(" ") : ""}`,
  });

  // 3-6 ── specialist agents in parallel, per unique leg
  const legs = new Map<string, Leg>();
  pl.itineraries.forEach((it) => it.legs.forEach((l) => legs.set(l.id, l)));
  const all: Signal[] = [];
  const run = async (name: string, f: () => Promise<Signal[]>) => {
    try {
      const s = await f();
      all.push(...s);
      if (s.length) send({ type: "signals", data: s });
    } catch (e: any) {
      emit({ agent: "orchestrator", stage: 6, status: "warn", text: `${name} failed: ${String(e?.message ?? e).slice(0, 120)}` });
    }
  };
  const jobs: Promise<void>[] = [];
  for (const leg of legs.values()) {
    jobs.push(run(`storm/${leg.mode}`, () => storm(leg, sh, emit)));
    jobs.push(run(`alerts/${leg.mode}`, () => alerts(leg, sh, emit)));
    if (leg.mode === "sea") jobs.push(run("maritime", () => maritime(leg, sh, emit)));
    if (leg.mode === "air") jobs.push(run("aviation", () => aviation(leg, sh, emit)));
    if (leg.mode === "rail" || leg.mode === "road") jobs.push(run("surface", () => surface(leg, sh, emit)));
  }
  jobs.push(run("news", () => news([...legs.values()], emit)));
  await Promise.all(jobs);

  // 7 ── corroboration
  emit({ agent: "corroborator", stage: 7, status: "start", text: "Checking whether independent kinds of evidence agree" });
  const legVerdicts = [...legs.values()].map((l) => verdictForLeg(l, all));
  for (const l of legs.values()) {
    const v = legVerdicts.find((x) => x.legId === l.id)!;
    emit({ agent: "corroborator", stage: 7, status: v.verdict === "green" ? "ok" : "warn", text: `${l.label}: ${V_WORD[v.verdict]} at ${Math.round(v.confidence * 100)}% confidence. ${v.reasons[0] ?? ""}` });
  }
  const primary = pl.itineraries.find((i) => i.id === pl.primary)!;
  const pv = itinVerdict(primary, legVerdicts);

  // 8 ── strategist + comms
  emit({ agent: "strategist", stage: 8, status: "start", text: "Comparing the primary routing with alternatives" });
  const pSafe = safetyOf(primary, legVerdicts, all);
  const alts: Alternative[] = pl.itineraries
    .filter((i) => i.id !== primary.id)
    .map((i) => {
      const v = itinVerdict(i, legVerdicts);
      const sf = safetyOf(i, legVerdicts, all);
      const topReason = v.worst ? legVerdicts.find((x) => x.legId === v.worst!.legId)?.reasons[0] : undefined;
      const kind = i.id.startsWith("avoid") ? "avoid" : i.id === "air" ? "air" : i.id.startsWith("alt-") ? "port" : i.id;
      const caveat =
        kind === "avoid"
          ? "Longer sailing. Whether a carrier offers this routing, on which dates and at what surcharge is not something Dhruva can see; ask your forwarder."
          : kind === "air"
            ? "Air freight usually costs several times more per kilogram and has weight and dangerous-goods limits. Capacity and price are not checked."
            : kind === "port"
              ? "Check port congestion, free days and inland haulage rates for this port; those are not in the sources Dhruva reads."
              : "Cost, capacity and schedules are not checked.";
      const dKm = i.km - primary.km;
      const dDays = i.days - primary.days;
      const change = `${dKm === 0 ? "Same distance" : `${dKm > 0 ? "+" : "−"}${Math.abs(Math.round(dKm)).toLocaleString("en-IN")} km`}, ${Math.abs(dDays) < 0.05 ? "same time" : `${dDays > 0 ? "+" : "−"}${Math.abs(dDays).toFixed(Math.abs(dDays) < 10 ? 1 : 0)} days`}`;
      return {
        id: i.id,
        label: i.label,
        itinerary: i,
        verdict: v.verdict,
        deltaKm: dKm,
        deltaDays: dDays,
        why: `${V_WORD[v.verdict]} on the same live checks. ${topReason ?? ""}`.trim(),
        caveat,
        score: sf.score,
        confidence: sf.confidence,
        switchConfidence: switchConfidence(sf.score, sf.confidence, pSafe.score, pSafe.confidence),
        exposures: sf.exposures.slice(0, 3).map((e) => e.title),
        change,
      } as Alternative;
    })
    .sort((a, b) => b.score - a.score || a.deltaDays - b.deltaDays);
  // Tags: the safest routing, and the best trade-off once every extra day costs 1.5 points of safety.
  const safer = alts.filter((a) => a.switchConfidence > 0 && a.verdict !== "abstain");
  if (safer.length) {
    safer[0].tag = "safest";
    const value = (a: Alternative) => a.score - 1.5 * Math.max(0, a.deltaDays);
    const bt = [...safer].sort((a, b) => value(b) - value(a))[0];
    if (bt && bt !== safer[0]) bt.tag = "tradeoff";
  }
  const betterAlt = alts.find((a) => VERDICT_RANK[a.verdict] > 0 && VERDICT_RANK[a.verdict] < VERDICT_RANK[pv.verdict]) ?? (pv.verdict !== "green" ? safer[0] : undefined);
  const action = actionFor(pv.verdict, !!betterAlt);
  send({ type: "alternatives", data: alts, deep });
  emit({
    agent: "strategist", stage: 8, status: "ok",
    text: betterAlt
      ? `Safest alternative: ${betterAlt.label}, safety ${betterAlt.score}/100 against ${pSafe.score}/100 for your plan; ${Math.round(betterAlt.switchConfidence * 100)}% sure it is safer (${betterAlt.deltaDays >= 0 ? "+" : ""}${betterAlt.deltaDays.toFixed(1)} days).`
      : alts.length ? `No alternative scores safer than ${pSafe.score}/100 on today's evidence.` : "No alternative routing applies.",
  });

  // evidence summary for narrative
  const primaryIds = new Set(primary.legs.map((l) => l.id));
  const ranked = all.filter((s) => primaryIds.has(s.legId) && s.severity > 0).sort((a, b) => b.severity - a.severity || b.confidence - a.confidence);
  const obs = all.flatMap((s) => s.sources.map((x) => x.observedAt).filter(Boolean) as string[]).sort();
  const worstLeg = pv.worst ? primary.legs.find((l) => l.id === pv.worst!.legId) : undefined;
  const reasons = pv.worst ? legVerdicts.find((x) => x.legId === pv.worst!.legId)!.reasons : ["No source returned fresh data."];
  const topTitle = ranked[0]?.title;
  let headline =
    pv.verdict === "green" ? `Green: nothing flagged on ${primary.label.replace(/^Main plan: /, "")}.` :
    pv.verdict === "abstain" ? "Can't tell: no source returned fresh data for this route." :
    `${V_WORD[pv.verdict]}: ${topTitle ?? "evidence is building on this route"}.`;
  let summary = [
    ...reasons,
    ranked[1] ? `Also: ${ranked[1].title}.` : "",
    betterAlt ? `${betterAlt.label} looks better on today's checks, ${Math.abs(betterAlt.deltaDays).toFixed(1)} days ${betterAlt.deltaDays >= 0 ? "longer" : "shorter"}.` : "",
  ].filter(Boolean).join(" ");

  let narrativeBy: FinalAnswer["narrativeBy"] = "template";
  const factText = JSON.stringify({ verdict: pv.verdict, reasons, topSignals: ranked.slice(0, 3).map((s) => ({ title: s.title, detail: s.detail })), alternative: betterAlt ? { label: betterAlt.label, deltaDays: betterAlt.deltaDays.toFixed(1), verdict: betterAlt.verdict } : null, route: primary.label });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 7000);
  const nar = await llmNarrative(factText, ac.signal);
  clearTimeout(timer);
  if (nar) {
    headline = nar.headline;
    summary = nar.summary;
    narrativeBy = "model";
    usedLlm = true;
  }

  const blind = [
    "Dhruva reads transit counts and hazard feeds. It does not see your container or vessel (no AIS tracking of a specific ship).",
    ...(primary.legs.some((l) => l.mode === "air") || alts.some((a) => a.itinerary.legs.some((l) => l.mode === "air")) ? ["Indian NOTAMs are not publicly available, so air checks use METAR, SIGMET and FAA data only."] : []),
    ...(primary.legs.some((l) => l.mode === "road" || l.mode === "rail") ? ["No live road-traffic or railway-operations feed is used; surface legs show weather and official-alert exposure only."] : []),
    "Transit days are estimates from distance and typical speeds, not carrier schedules.",
  ];
  const final: FinalAnswer = {
    overall: pv.verdict,
    confidence: pv.confidence,
    primaryScore: pSafe.score,
    headline,
    summary,
    narrativeBy,
    legs: legVerdicts,
    action,
    asOf: new Date().toISOString(),
    freshness: {
      oldestObservation: obs[0],
      newestObservation: obs[obs.length - 1],
      note: `Read at ${todayZ()} UTC. Newest observation in the evidence: ${obs.length ? obs[obs.length - 1].slice(0, 16).replace("T", " ") + " UTC" : "none"}.`,
    },
    blindSpots: blind,
  };
  send({ type: "verdict", data: final });

  // comms
  emit({ agent: "comms", stage: 8, status: "start", text: "Drafting the supplier message in four languages" });
  const via = betterAlt ? altVia(betterAlt, primary) : undefined;
  const evidence = ranked.slice(0, 2).map((s) => s.title).join("; ") || "No unusual signals in the sources checked.";
  const msgs = {} as Record<Lang, string>;
  for (const l of LANGS) {
    msgs[l.id] = compose(l.id, {
      cargo: parsed.cargo,
      from: parsed.origin.name.split(" (")[0],
      to: parsed.destination.name.split(" (")[0],
      verdict: pv.verdict,
      where: worstLeg?.label ?? primary.label,
      asOf: todayZ(),
      evidence,
      action,
      via,
      extraDays: betterAlt?.deltaDays,
    });
  }
  send({ type: "messages", data: msgs });
  emit({ agent: "comms", stage: 8, status: "done", text: "Messages ready. Dhruva only drafts; it never sends." });
  send({ type: "done", data: { tookMs: Date.now() - t0, llm: usedLlm } });
}

function altVia(a: Alternative, primary: Itinerary): string {
  const have = new Set(primary.legs.flatMap((l) => (l.chokepoints ?? []).map((c) => c.key)));
  const fresh = a.itinerary.legs.flatMap((l) => l.chokepoints ?? []).filter((c) => !have.has(c.key)).map((c) => c.name);
  return fresh.length ? fresh.join(" and ") : a.label;
}

export type { SourceStamp };
