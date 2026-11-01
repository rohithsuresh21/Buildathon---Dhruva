# Dhruva

**Know before it lands.** Dhruva is a multi-agent shipment risk desk and hand-over booking tool for Indian MSME importers and exporters. Type a shipment in one sentence; specialist agents check the sea, air, rail and road legs against live chokepoint, cyclone, alert, weather and aviation feeds, then say how sure they are and what to do. When you are ready to send, Dhruva finds the best courier or post-office agency near you and books your hand-over time.

Built for the Forge Gen AI buildathon, Theme 2: Climate, Resource Infrastructure and Global Supply Resilience.

## Why it exists

A small exporter in Indore has no control tower. A cyclone near Mundra, a closed strait, or a held-up airport shows up as a missed delivery weeks later. Dhruva puts the same live signals a freight desk watches in front of the person shipping, in plain words, and then carries the decision through to the counter where the parcel is actually handed over.

## What it does

| Stage | What happens | Where |
|---|---|---|
| 1. Describe | One sentence, such as "500 kg of tiles from Morbi to Rotterdam". Intake resolves places from a 2,200-place directory of ports, airports, ICDs, CFSs and rail yards. | `src/lib/agents/intake.ts` |
| 2. Plan | The planner builds candidate routings (sea, air, rail, road, multimodal) with real geometry. | `src/lib/agents/planner.ts` |
| 3. Check | Specialist agents read live feeds per leg. A deterministic corroborator turns signals into a verdict and a confidence. | `src/lib/agents/` |
| 4. Find safer | A deeper search avoids chokepoints, tries other ports and an air option, and scores each by today's live checks. | `src/components/Safer.tsx` |
| 5. Hand over | Share your location, see ranked nearby agencies, approve one, and get a signed booking slip with a calendar entry. | `src/components/Handover.tsx` |

## Principles

- **Real data only.** No mock, recorded or invented figures. When a feed is down the desk says so and lowers its confidence or abstains.
- **Say what is not known.** Every score drops evidence it does not have instead of guessing, and reports how much of the score rested on evidence.
- **A human decides.** Dhruva gives an opinion and a ranked list. Nothing is booked until the customer reads the review and approves it.
- **No database, no account.** Bookings are signed links. The sender profile stays in the browser.

## Architecture

```
 Browser (Next.js App Router, React 19)
 ├─ /            landing: 3D globe, scroll story
 ├─ /desk        the desk: sentence → plan → verdict → safer routes → hand-over
 └─ /order/<t>   hand-over slip (signed link, printable)
        │
        ▼  NDJSON stream
 /api/analyze ─ orchestrator ─┬─ intake      parses the sentence
                              ├─ planner     lanes, ports, geometry (OSRM for road)
                              ├─ maritime    IMF PortWatch chokepoints
                              ├─ storm       GDACS cyclones, Open-Meteo marine and wind
                              ├─ aviation    AviationWeather, FAA NAS
                              ├─ surface     NDMA Sachet, USGS, GDELT headlines
                              ├─ corroborator  deterministic verdict and confidence
                              ├─ strategist  safer routings, ranked by live checks
                              └─ comms       plain-language message, several languages
 /api/agencies ─ OpenStreetMap (Overpass) [+ Google Places if keyed] → score → rank
 /api/orders   ─ validate → seal (HMAC) → optional email → signed link
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Data sources and their limits: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md). The booking flow: [docs/BOOKING.md](docs/BOOKING.md).

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local     # optional: add keys, see below
npm run dev                    # http://localhost:3000
```

```bash
npm run typecheck              # tsc --noEmit
npm run build && npm start     # production build
```

## Configuration

Everything is optional except `ORDER_SECRET` in production. See [.env.example](.env.example).

| Variable | Purpose | Without it |
|---|---|---|
| `ORDER_SECRET` | Seals booking links (16+ characters). | Bookings are refused in production; a fixed dev secret is used locally. |
| `GOOGLE_MAPS_API_KEY` | Adds Google Places ratings to the agency ranking. | Reputation is left out of the score and the list says "No rating on file". |
| `RESEND_API_KEY`, `RESEND_FROM` | Emails the confirmation. | No email is sent; the slip page and calendar file still work. |
| `AI_GATEWAY_API_KEY` | Lets a language model polish intake and the written summary. | Rules and templates are used; the verdict logic is never model-made. |

## Deploying

The project deploys to Vercel as a standard Next.js app. Set `ORDER_SECRET` as a sensitive production variable. See [docs/BOOKING.md](docs/BOOKING.md#deploying) for the optional keys.

## Repository layout

```
src/app          routes, API handlers, global styles
src/components   desk, landing, globe, handover UI
src/lib          agents, live-feed adapters, agency finder, bookings, place directory
data-build       reproducible build of the place directory, with provenance
scripts          asset scripts
public           static map data and textures
docs             architecture, data sources, booking flow
```

Each folder has its own README.

## Honest limits

- Ratings need a Google Places key; the keyed path has not been exercised against the live API in this build.
- OpenStreetMap coverage of courier shops is uneven. Small towns may return few or no results.
- Agencies publish no booking API. Dhruva records the plan you approved and gives you a slip; it does not contact the agency.
- Price and queue length are not judged because no free source publishes them. Payment is made at the counter.
- Carrier capabilities in `src/lib/agencies/catalog.ts` are curated knowledge, not a live feed.
- IMF PortWatch is sometimes down upstream; chokepoint cards say so.

See [VALIDATION.md](VALIDATION.md) for the data checks behind the place directory.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).
