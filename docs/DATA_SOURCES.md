# Data sources

All sources are free to read and require no key unless stated. Each response carries a stamp with the fetch time and, when the source provides one, its own observation time.

## Live, fetched per request

| Source | Used for | Notes |
|---|---|---|
| IMF PortWatch | Chokepoint transit counts against usual | Intermittently down upstream; the desk says so |
| GDACS | Tropical cyclones and other disasters | |
| Open-Meteo (forecast, marine, geocoding) | Wind, waves, rain at ports and along routes; place lookup | |
| India NDMA Sachet | Official alerts for Indian districts | |
| USGS | Earthquakes | |
| NOAA AviationWeather, FAA NAS | METARs, SIGMETs, airport delays | |
| OSRM | Road route geometry | OpenStreetMap-derived |
| GDELT | Headlines near a place | Used when it answers |
| OpenStreetMap via Overpass | Courier shops, post offices, logistics offices near a point | Two public mirrors; coverage varies by town |
| Google Places (New) | Ratings and review counts for agencies | Only with `GOOGLE_MAPS_API_KEY` |

## Static, open data (built once, see `data-build/`)

| Dataset | Source |
|---|---|
| Ports | NGA World Port Index and UN/LOCODE |
| Airports | OurAirports, route counts from OpenFlights |
| Indian ICDs, CFSs, rail yards | datameet/railways and UN/LOCODE |

About 2,200 places after de-duplication. Provenance, fingerprints and drop reasons: [data-build/PROVENANCE.md](../data-build/PROVENANCE.md). Checks run: [VALIDATION.md](../VALIDATION.md).

## Curated, not live

`src/lib/agencies/catalog.ts` lists what each major carrier is known to offer (international, air, freight). It is knowledge, not a feed; `false` means "not established", and the code treats it that way.

## Not available from any free source

Agency prices, queue lengths, parcel capacity and a booking API. Dhruva does not show or estimate them.
