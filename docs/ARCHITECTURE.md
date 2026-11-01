# Architecture

## Shape

Dhruva is one Next.js App Router application. There is no database and no background worker: every request reads live feeds, computes, and streams or returns the result.

```
Browser ──► /api/analyze  (NDJSON stream of trace, parsed, plan, signals, verdict, alternatives, messages)
        ──► /api/agencies (ranked hand-over agencies near a point)
        ──► /api/orders   (create a signed booking)      /api/orders/<token> (calendar file)
        ──► /api/places   (place search)   /api/route (road geometry)   /api/pulse, /api/health (feed status)
```

## Agents

| Agent | Job | Model involved? |
|---|---|---|
| intake | Turns the sentence into origin, destination, cargo and a mode hint | Rules first; a model may help on hard sentences |
| planner | Builds candidate itineraries with geometry (sea graph, great-circle air, rail corridors, OSRM road) | No |
| maritime, storm, aviation, surface, alerts, news | Read one family of live feeds per leg and emit signals with severity and timestamps | No |
| corroborator | Combines signals into a leg verdict and a confidence; abstains when evidence is thin | No |
| strategist | Searches wider for safer routings and scores each by the same live checks | No |
| comms | Writes the message to the supplier in several languages | Optional; template fallback |

The orchestrator (`src/lib/agents/orchestrator.ts`) runs them in stages and emits a trace event for each step, which the desk shows as it happens. The verdict is deterministic so it can be tested and explained; models only rephrase.

## Hand-over (customer side)

1. **Locate.** The browser location, a searched area, or the shipment origin.
2. **Find.** `/api/agencies` queries OpenStreetMap through Overpass (several public mirrors in parallel, first good answer wins, with Nominatim as a faster, sparser backup), optionally merges Google Places, then scores each place.
3. **Score** (`src/lib/agencies/score.ts`, deterministic, 0 to 100): distance 30, service fit 25, listing details 20, open at the chosen hour 10, reputation 15. A part with no evidence is dropped from both sides of the fraction, and `coverage` reports how much of the 100 rested on evidence.
4. **Approve.** The customer reviews Dhruva's opinion, the agency, the time and their details, and ticks the approval box.
5. **Seal.** `/api/orders` validates, builds the order, and seals it: `base64url(json) + "." + HMAC-SHA256(secret)`. The URL is the record.

## Why signed links instead of a database

It keeps the product free to host, makes bookings portable across devices, and removes personal data from Dhruva's storage. The cost is that a booking cannot be edited after the fact; the customer places a new one.

## Failure behaviour

Every upstream call has a timeout and a source stamp (id, fetch time, the source's own observation time, ok or not). A failed feed lowers confidence or makes the verdict abstain, and the desk says which feed failed. The agency finder asks several Overpass mirrors at once falls back to Nominatim when none answers in time, and says so in the response notes.
