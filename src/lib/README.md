# src/lib

Application logic with no React in it (except `profile.ts`, a client hook).

| Path | Purpose |
|---|---|
| `agents/` | Intake, planner, signals, orchestrator, structured-output helper |
| `agencies/` | Agency finder types, carrier catalog, opening-hours parser, scoring |
| `sources/` | One adapter per live feed |
| `gz/` | Place directory data (ports, airports, inland terminals) |
| `orders.ts` | Booking schema, sealing, calendar file, optional email |
| `profile.ts` | Browser-only sender profile hook |
| `compose.ts` | Verdict wording, languages, recommended action |
| `safety.ts`, `judge.ts` | Safety score and verdict rules |
| `seagraph.ts`, `lanes.ts`, `geo.ts` | Sea graph, lane rules, geometry helpers |
| `gazetteer.ts` | Place index over `gz/` |
| `http.ts` | Fetch wrapper with timeouts, caching and source stamps |
| `types.ts`, `analysis-types.ts`, `pulse-types.ts` | Shared types |
