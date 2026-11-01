# Dhruva place datasets: provenance

Built 2026-10-31 in the sandbox (reachable: registry.npmjs.org, raw.githubusercontent.com; blocked: msi.nga.mil, ourairports.com, openflights.org, unpkg, jsdelivr, codeload, GitHub search API).
Reproduce: `./fetch.sh raw && python3 -I build.py raw .` then `COAST_PTS=raw/coast_pts.npy python3 -I validate.py .`
Raw-input fingerprints (sha256 prefix): unlocode.csv 625748a1729b4864, airports.csv 423a70f3a3a6b849, runways.csv 30364d9cff967c34, routes.dat bd373706238134f6, stations.json 9bd5e1da3a859e53, schedules.json 105d63816acb177e, wpi_all.json f6133004c5c74ed7. GitHub files are `main`/`master` HEAD as of 2026-10-30 (commit SHAs could not be read: the GitHub API is blocked in this sandbox).

Row-level provenance sidecars (not for the app bundle): `ports.sources.json` [name, cc, WPI|UNLOCODE, WPI harbor_size, score], `india-surface.sources.json` [row..., source, note], `build-stats.json` (every drop/reject reason).

## Final files

| File | Bytes (cap) | Rows | Schema |
|---|---|---|---|
| ports.json | 48,602 (71,680) | 1,166 (66 India + 1,100 rest of world) | [name, ISO2, lat, lon, sizeClass 0-3, UN/LOCODE or ""] |
| airports.json | 46,073 (46,080) | 878 (116 India = all Indian airports with scheduled service + IATA) | [name, ISO2, lat, lon, IATA, ICAO, sizeClass 0-3] |
| india-surface.json | 10,639 (25,600) | 202 | [name, kind, state, lat, lon] |

Coordinates rounded to 2 decimals (about 1.1 km). No row was typed in by hand; every row is a source row. Hand-made inputs are only (a) the NAMED list in build.py (which user-named site maps to which source row id; coordinates still come from the source), (b) the two WPI river-port names accepted as `inland_port`, (c) the spot-check oracle coordinates in validate.py (never shipped).

## 1. ports.json

**Primary source: NGA World Port Index (Pub. 150), April 2025 edition, via npm `seaport-data-js@1.0.1`** (https://registry.npmjs.org/seaport-data-js ; repo github.com/aashishvanand/seaport-data-js). The package embeds the full WPI (3,802 ports after the package's own de-duplication) with WPI harbor size, facilities, depths and UN/LOCODE. Dumped by calling `getPortsByCountryCode` for each country (3,802 rows recovered = package `getPortCount()`).
- Licence: WPI is a US Government work (public domain; the package README says so, Wikipedia says NGA documents are public domain). The npm wrapper is **CC BY 4.0** (package.json/LICENSE), so credit it.
- Rows: WPI 3,802 -> 55 India kept (all) + 1,100 rest-of-world.

**Supplement (India only): UN/LOCODE "pre-release latest" via github.com/datasets/un-locode `data/code-list.csv`** (116,272 rows; also `subdivision-codes.csv`).
- Licence: **UNCLEAR.** The maintainers' own ATTRIBUTION.txt says UNECE's site terms allow personal non-commercial use only while another UNECE footer says CC BY 4.0; they could not establish which applies. The datasets repo packaging is PDDL, but that does not cover the data. Treat as an open licence risk (see "What to show").
- Filter: country IN, function position 1 = "1" (port), not marked X (282 entries), coordinates present (only 76 of 282; **206 Indian port entries have no coordinates and were dropped, not guessed**). Of the 76: dropped if the LOCODE is already in WPI, if within 10 km of an existing WPI Indian port, if the name/remark says ICD/CFS/SEZ (those go to india-surface), or if not on the coast (distance to Natural Earth 10m coastline > 12 km for approved status, > 5 km for status RL). Result: **11 added** (Alleppey, Amini Island, Kalpeni Island, Mahe, Mul Dwarka, Tadri, Vazhinjam, Bharuch, Mithivirdi, Positra, Thane). Each can be removed via `ports.sources.json` (src = UNLOCODE).
- WPI had one wrong LOCODE reused (Kattupalli Port carried INKRI = Krishnapatnam's); 16 duplicated LOCODEs were resolved by name match against UN/LOCODE and the loser blanked.

**Selection of the rest of the world (1,100 ports):** score every WPI port (below); keep per-country minimums (3 for every country; 25 for PK BD LK MV NP MM; 20 for ID MY TH VN PH SG KH BN TL; 14 for AE SA OM QA KW BH IR IQ YE JO IL EG TR and for KE TZ MZ MG SO DJ ER SD MU SC KM; 12 for 29 European countries), then fill to 1,100 by global score. The 70 KB cap was never hit, so nothing was cut. Countries with fewer WPI rows than the floor are limited by the source (PK 3, BD 2, BG 2, DJ 2, KH 2, MV 1).

**Size class (0 tiny .. 3 large)** is *derived*, because WPI has no throughput. score = harbor_size (Large 3, Medium 2, Small 1, Very Small/None 0) + 1.5 container facility or crane + cargo-pier depth (>=15 m 1.5, >=12 m 1.0, >=9 m 0.5) + max vessel length (>=300 m 1.0, >=200 m 0.5) + 0.5 channel >=10 m + 0.5 harbor_use Cargo (-1 Fishing/Military) + 0.5 oil/LNG terminal. Class 3 >= 5.0, 2 >= 3.0, 1 >= 1.5, else 0; WPI "Large" is floored at 2. UN/LOCODE-added Indian ports are fixed at class 1 (no attributes). Resulting classes: 3 = 123, 2 = 458, 1 = 303, 0 = 282.

**Known gaps / weaknesses**
- Sizes are a heuristic on WPI attributes, not cargo volume. WPI attributes are patchy (cargo-pier depth for Rotterdam is 6.4 m, so it scores class 2, not 3; Haldia scores class 1 while handling far more cargo than that; Shanghai/Hamburg also class 2). If you need real ranking, join UNCTAD/World Bank throughput (no keyless GitHub/npm source was found).
- India coverage is 66 ports: WPI's 55 plus 11. UN/LOCODE lists 206 further Indian port-function locations (Alibag, Dwarka, Jakhau, Bhatkal, Diu, Daman, Dahanu ...) with no coordinates; they are absent. No Gujarat Maritime Board / Maharashtra non-major / IWAI dataset with coordinates was found on npm or reachable GitHub. `sea-ports@0.0.9` (MIT; 36 Indian rows) was inspected and adds only Daman; its README states "GPS coordinates are not all correct" and its provenance is not stated, so it was **not** used.
- WPI "name" is the port-area location, not always the container terminal: Rotterdam is 51.90N 4.48E (city), not the Maasvlakte entrance; Singapore appears as "Keppel - (East Singapore)"; Jebel Ali as "Mina Jabal Ali". Pakistan has only 3 WPI rows and Bangladesh 2.
- Some WPI entries are oil fields/offshore terminals (e.g. Zirkuh Oil Field); they are real WPI ports but not typical cargo ports.
- 3 duplicate non-empty LOCODEs remain within WPI (FRDKK, SVAQJ, THSRI); 3 rows have a LOCODE whose country prefix differs from ISO2 (BQ/EH/GP territories). Reported as warnings.
- Calcutta (Kolkata) is 42.8 km from the 10m coastline because it is a Hooghly river port; expected.

## 2. airports.json

**Source: OurAirports `airports.csv` + `runways.csv`** (github.com/davidmegginson/ourairports-data, main; 86,311 rows). Licence: public domain (stated at ourairports.com/data; not fetchable here, but OpenFlights' data page also says its OurAirports-derived airport data is public domain, and the repo README links to ourairports.com for documentation).
- Filter: `scheduled_service = yes`, non-empty `iata_code`, type large/medium/small -> **4,010 candidates**. Kept 878.
- Ordering for the 45 KB cap: all 116 Indian candidates first (this is every Indian airport that has scheduled service and an IATA code in OurAirports), then everyone else by **route-connectivity** (number of routes touching the IATA code in OpenFlights `routes.dat`, github.com/jpatokal/openflights master, 67,663 routes), ties by longest runway. Cut-off: the lowest kept non-India airport has 26 routes; the highest dropped has 26; none dropped has >= 30. Names shortened by removing a trailing "International Airport"/"Airport".
- **OpenFlights licence: ODbL 1.0 (database) / DbCL (contents); requires attribution and share-alike for publicly distributed derived databases.** routes.dat is used only as a ranking signal (no OpenFlights rows are emitted) but a strict reader could call the selection derived; credit it. routes.dat is a 2014 snapshot (OpenFlights says its supplier stopped updating in June 2014), so connectivity ranking is dated.
- **Size class:** 3 = OurAirports large_airport with >= 100 routes (308 rows); 2 = other large_airport, or medium with >= 30 routes (467); 1 = remaining with >= 5 routes or medium (93); 0 otherwise (10). Indian airports: 7 class 3, 36 class 2, 63 class 1, 10 class 0.
- **Cargo airports:** no cargo-tonnage dataset was reachable. Passenger-hub ranking already keeps MEM, SDF, ANC, LEJ, CGN, HHN, CAN, PVG, ICN, HKG, DXB, DOH, CVG, MIA, ORD, KIX, NRT, SZX, CTU, COK and others. **Cargo-only fields that have no scheduled passenger service are excluded by the brief's own filter** (e.g. LGG Liege, RFD Rockford, AFW Fort Worth Alliance are not in the output). `runway >= 3000 m` was *not* used as a cargo proxy in the final ordering.
- Known caveats: OurAirports "large_airport" is broad (1,153 scheduled/IATA rows); ICAO blank where OurAirports has none; 936 candidates (mostly small) have zero OpenFlights routes and rank last.

## 3. india-surface.json (202 rows: 53 icd, 1 cfs, 13 rail_terminal, 133 junction, 2 inland_port, 0 dry_port)

**Sources**
- UN/LOCODE (as above; licence unclear): 46 icd + 1 cfs rows. Rule: India rows with coordinates whose Name/Remarks contain ICD, or Name contains "Cfs", or "Container Terminal". Identical-coordinate CFS rows collapsed ("Dadri CFS cluster (5 operators)"). Names where only the remark says ICD/CFS are suffixed "ICD/CFS". UN/LOCODE coordinates are degree+minute (about 1.8 km grain).
- **datameet/railways `stations.json` + `schedules.json`** (github.com/datameet/railways, master; 8,990 stations of which 8,697 have geometry; 417,080 schedule rows). Licence **CC0** (README; the repo has no LICENSE file). Used for: 7 icd rows (see below), 13 freight yards (station names containing GOODS / MARSHAL / EXCHANGE YARD / THROUGH YARD / R YARD / VARANASI YARD, excluding COACHING/CABIN/SORTING/SIDING), and 133 junctions.
- NGA WPI (above): Haldia Port and Calcutta (harbor_type "River ...") as `inland_port`.
- Natural Earth (public domain): India state polygons (admin-1 10m) to assign `state` to every row; land polygons to reject offshore UN/LOCODE points (none rejected).

**User-named nodes:** Tughlakabad, Dadri, Khodiyar, Sanand, Jaipur-Kanakpura, Dhandarikalan (Ludhiana), MIHAN (Nagpur), Varanasi, Haldia are present. **Patparganj and Pithampur are dropped: UN/LOCODE lists both without coordinates and datameet has no matching station.** Kanakpura, Sanand, Dhandari Kalan, Dadri, Khodiyar, Tughlakabad and Varanasi use the datameet station coordinate (the ICD adjoins the station; this is a proxy for the yard, not the ICD gate), MIHAN uses UN/LOCODE "Concor ICD/Mihan".
- **Disagreement found:** UN/LOCODE places Khodiyar at 23.05N 72.93E, datameet station at 23.16N 72.55E, 41 km apart; the datameet station was used.
- **Junctions:** station name contains "JN"/"JUNCTION" and >= 100 distinct scheduled trains in datameet schedules (133 rows). This measures *passenger-timetable* centrality, a proxy for rail-network hubs; it is not freight tonnage. No freight-volume or DFC-terminal dataset was found, so freight-only terminals (DFC, CONCOR terminals) are covered only where UN/LOCODE or station names mention them.
- **State** from Natural Earth polygons (36 states/UTs incl. Telangana, Ladakh). Source-given state disagreed for 9 rows (e.g. Secunderabad Jn "Andhra Pradesh" -> Telangana, Kiul Jn "Jharkhand" -> Bihar, Dhanbad Jn "West Bengal" -> Jharkhand, Tirupattur Jn "Karnataka" -> Tamil Nadu); polygon used. Tughlakabad keeps Delhi (polygon puts the rounded point on the Haryana side of a border).
- 3 near-duplicate rows were collapsed (Concor-ICD/Ballabhgarh into GRFL ICD/Ballabhgarh, same UN/LOCODE coordinate; Kanpur M. G. Goods into Kanpur Goods Marshal; Sabarmati Jn duplicate).
- **Gaps:** no `dry_port` rows (no source labels them); no inland-waterway terminals (Varanasi/Sahibganj/Pandu IWAI terminals) in any reachable dataset - only Haldia and Kolkata via WPI; UN/LOCODE ICD/CFS coverage is whatever UNECE lists (many Indian ICDs/CFSs are missing, e.g. most private CFSs near JNPT/Mundra); station coordinates in datameet are crowd-geocoded (about 48% of stations carry a state/address, geometry for 97%).

## 4. Validation (see validate-output.txt)
0 hard failures. 33 spot checks (18 ports, 15 airports): 32 within 0.1 degree; 1 deviation: **Rotterdam** file 51.90N 4.48E vs reference 51.95N 4.14E (0.34 deg lon, about 24 km - the WPI point is the city/port-authority location, the reference is the Maasvlakte entrance). Warnings (informational): duplicate LOCODEs inside WPI, 3 territory LOCODE prefixes, Calcutta far from coast. India port bounding box (6.5-24.0N, 68-94E) passes; **no EEZ polygon was reachable, so that stronger test was not run** (a coastline-distance test substitutes: all Indian ports except river-port Calcutta are within 15 km of the 10m coastline).
Spot-check reference coordinates are from the author's own knowledge and the brief; they are test oracles, not data.

## What to show in the app footer
> Ports: NGA World Port Index (Pub. 150, U.S. Government, public domain) via seaport-data-js (CC BY 4.0, A. Vanand); additional Indian ports and ICD/CFS locations from UN/LOCODE (UNECE). Airports: OurAirports (public domain); airport ranking uses OpenFlights route data (ODbL 1.0, openflights.org). Indian rail data: datameet/railways (CC0). Boundaries used in processing: Natural Earth (public domain).

Open licence item to decide before shipping: the UN/LOCODE terms are unclear (11 ports + 47 surface rows depend on it). To remove them, filter rows whose source is UNLOCODE in `ports.sources.json` / `india-surface.sources.json`.
