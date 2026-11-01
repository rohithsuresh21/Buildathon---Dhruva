# src/lib/sources

One adapter per upstream feed. Each returns data plus a `SourceStamp` (id, fetch time, observation time, ok, note) through `../http.ts`.

`portwatch` (IMF chokepoints), `gdacs` (cyclones), `openmeteo` (weather, marine, geocoding), `sachet` (India alerts), `usgs` (quakes), `air` (METAR, SIGMET, FAA), `osrm` (road), `news` (GDELT), `osm` (agencies via Overpass), `googleplaces` (ratings, key required).

Adding a source: write the adapter, return a stamp, handle failure by returning ok false, and list it in `docs/DATA_SOURCES.md`.
