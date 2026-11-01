# Dhruva data validation (31 Oct 2026)

## Overall: share with caveats

## What is real
- Live signals (fetched per request, stamped with fetch time and the source's own observation time): IMF PortWatch, GDACS, Open-Meteo (forecast, marine, geocoding), India NDMA Sachet, USGS, NOAA AviationWeather, FAA NAS, OSRM (road routing), GDELT (when it answers).
- Place directory (static, open data): NGA World Port Index and UN/LOCODE ports, OurAirports airports (route counts from OpenFlights), datameet/railways plus UN/LOCODE for Indian ICDs, CFSs and rail yards. About 2,200 places.
- No mock, pre-recorded or invented figures. When a feed is down the desk says so and the verdict abstains or lowers confidence.

## Checks run
- Coordinates: every port, airport and depot is inside -90..90 / -180..180; spot checks (Mundra, Jebel Ali, Kakinada, Hamburg, DEL, HAM) match known positions.
- Dedupe: ports within 12 km merge; same name within 60 km merges (this removed a duplicate Rotterdam).
- Route tests: Jebel Ali to Mundra (sea, 1,879 km), Kakinada Bay to Hamburg (sea, 15,227 km, plus a Bab el-Mandeb avoidance routing and an air alternative), Tughlakabad ICD to Mundra (rail 1,071 km, road and air alternatives), Surat to Kolkata (road).
- UI: the chokepoint sparkline charts were removed; chokepoint state is shown as "ships a day vs usual".

## Caveats
1. IMF PortWatch has been intermittently down upstream; when it is, chokepoint cards say so instead of guessing.
2. Port size classes are a heuristic (rank by NGA harbour size); only size 2+ bulk ports are offered as nearest-port candidates.
3. The sea graph has 114 nodes; about 46% of world ports snap to it. Others route via the nearest snapped port and the plan says so.
4. India has 66 ports with usable coordinates (206 UN/LOCODE rows had none). Patparganj and Pithampur ICDs are missing.
5. Road distances use OSRM; if it is unreachable the leg is a straight line plus 25% and the note says so.
6. UN/LOCODE licence terms are ambiguous for 11 ports and 47 inland rows; confirm before any commercial release.
7. The Hormuz "structural" baseline rule is unverified against a long history.
