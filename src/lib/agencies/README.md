# src/lib/agencies

The hand-over agency finder.

| File | Purpose |
|---|---|
| `types.ts` | `Agency`, `Fit`, `Need`, `Slot` |
| `catalog.ts` | Curated carrier capabilities. Knowledge, not a feed; `false` means not established |
| `hours.ts` | Reads the common subset of OSM `opening_hours`; returns open, closed or unknown |
| `score.ts` | Fit score 0 to 100. Unknown parts are dropped, and `coverage` says how much was judged |

Data comes from `../sources/osm.ts` and, with a key, `../sources/googleplaces.ts`.
