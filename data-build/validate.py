#!/usr/bin/env python3
"""Validate Landfall datasets.  Usage: python3 -I validate.py [DIR]   (DIR defaults to script dir)
Exit code 1 if any hard check fails.  Spot-check 'oracle' coordinates are typed from the
author's geographic knowledge (as requested) and are NOT part of any shipped data."""
import json, math, os, re, sys, collections

D = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
ISO = set("""AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW""".split())
fails, warns = [], []


def hav(a, b, c, d):
    p1, p2 = math.radians(a), math.radians(c)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(d - b) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def load(n):
    p = os.path.join(D, n)
    return json.load(open(p, encoding="utf-8")), os.path.getsize(p)


def sec(t): print("\n=== " + t)


ports, ps = load("ports.json"); air, as_ = load("airports.json"); sur, ss = load("india-surface.json")
print("files: ports.json %d B (%d rows, cap 71680), airports.json %d B (%d rows, cap 46080), india-surface.json %d B (%d rows, cap 25600)" % (ps, len(ports), as_, len(air), ss, len(sur)))
for n, sz, cap in (("ports", ps, 70 * 1024), ("airports", as_, 45 * 1024), ("india-surface", ss, 25 * 1024)):
    if sz > cap: fails.append("%s over size cap" % n)

sec("1. Schema, coordinate ranges, rounding")
def chk_rows(name, rows, ncol, latI, lonI, ccI, extra):
    bad = 0
    for r in rows:
        ok = isinstance(r, list) and len(r) == ncol and isinstance(r[latI], (int, float)) and isinstance(r[lonI], (int, float))
        if ok: ok = -90 <= r[latI] <= 90 and -180 <= r[lonI] <= 180 and not (r[latI] == 0 and r[lonI] == 0)
        if ok: ok = abs(round(r[latI], 2) - r[latI]) < 1e-9 and abs(round(r[lonI], 2) - r[lonI]) < 1e-9
        if ok and ccI is not None: ok = r[ccI] in ISO
        if ok: ok = extra(r)
        if not ok: bad += 1; fails.append("%s bad row: %r" % (name, r))
    print("%-14s rows=%d bad=%d" % (name, len(rows), bad))
chk_rows("ports", ports, 6, 2, 3, 1, lambda r: r[4] in (0, 1, 2, 3) and (r[5] == "" or re.fullmatch(r"[A-Z]{2}[A-Z0-9]{3}", r[5])) and r[5][:2] in ("", r[1]) or (r[5][:2] != r[1] and warns.append("port LOCODE country prefix differs from country: %r" % (r,)) is None))
chk_rows("airports", air, 7, 2, 3, 1, lambda r: re.fullmatch(r"[A-Z0-9]{3}", r[4]) and (r[5] == "" or re.fullmatch(r"[A-Z0-9]{3,4}", r[5])) and r[6] in (0, 1, 2, 3))
INSTATES = {"Andaman and Nicobar", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"}
chk_rows("india-surface", sur, 5, 3, 4, None, lambda r: r[1] in ("rail_terminal", "icd", "cfs", "dry_port", "inland_port", "junction") and r[2] in INSTATES)
print("surface kinds:", dict(collections.Counter(r[1] for r in sur)))
print("airports/ports country codes unique-valid:", len({r[1] for r in ports}), "port countries;", len({r[1] for r in air}), "airport countries")

sec("2. Duplicates (same name + country within 5 km; duplicate codes)")
def dups(name, rows, nameI, ccI, latI, lonI):
    n = 0
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = rows[i], rows[j]
            if a[nameI].lower() == b[nameI].lower() and (ccI is None or a[ccI] == b[ccI]) and hav(a[latI], a[lonI], b[latI], b[lonI]) < 5:
                n += 1; fails.append("%s duplicate: %r / %r" % (name, a, b))
    print("%-14s same-name<5km duplicates: %d" % (name, n))
dups("ports", ports, 0, 1, 2, 3); dups("airports", air, 0, 1, 2, 3); dups("india-surface", sur, 0, None, 3, 4)
c = collections.Counter(r[4] for r in air); d = [k for k, v in c.items() if v > 1]
print("airports duplicate IATA:", d); fails += ["dup IATA " + k for k in d]
c = collections.Counter(r[5] for r in ports if r[5]); d = [k for k, v in c.items() if v > 1]
print("ports duplicate non-empty LOCODE:", d); warns += ["dup LOCODE " + k for k in d]
# near-duplicates by position regardless of name (informational)
n = sum(1 for i in range(len(ports)) for j in range(i + 1, len(ports)) if ports[i][1] == ports[j][1] and hav(ports[i][2], ports[i][3], ports[j][2], ports[j][3]) < 1.0)
print("ports: different-name pairs <1 km apart, same country (informational):", n)

sec("3. India bounding boxes")
# India incl. Andaman & Nicobar and Lakshadweep: lat 6.5-24.0 for ports (coastal), lon 68.0-94.0; surface nodes lat 6.5-35.5, lon 68-97.5
bad = [r for r in ports if r[1] == "IN" and not (6.5 <= r[2] <= 24.0 and 68.0 <= r[3] <= 94.0)]
print("Indian ports outside coastal bbox [6.5-24.0N, 68-94E]:", bad); fails += ["IN port outside bbox %r" % r for r in bad]
bad = [r for r in air if r[1] == "IN" and not (6.5 <= r[2] <= 35.5 and 68.0 <= r[3] <= 97.5)]
print("Indian airports outside bbox:", bad); fails += ["IN airport outside bbox %r" % r for r in bad]
bad = [r for r in sur if not (6.5 <= r[3] <= 35.5 and 68.0 <= r[4] <= 97.5)]
print("India surface outside bbox:", bad); fails += ["surface outside bbox %r" % r for r in bad]
print("NOTE: no EEZ polygon was available in the sandbox; a bounding box is a weaker test than an EEZ test.")
coastf = os.environ.get("COAST_PTS")
if coastf and os.path.exists(coastf):
    import numpy as np
    from scipy.spatial import cKDTree
    pts = np.load(coastf)
    def xyz(la, lo):
        la = np.radians(la); lo = np.radians(lo); return np.c_[np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]
    T = cKDTree(xyz(pts[:, 0], pts[:, 1]))
    far = []
    for r in ports:
        if r[1] == "IN":
            d, _ = T.query(xyz(np.array([r[2]]), np.array([r[3]]))[0]); 
            if d * 6371 > 15: far.append((r[0], round(d * 6371, 1)))
    print("Indian ports >15 km from Natural Earth 10m coastline (COAST_PTS test):", far); warns += ["IN port far from coast %r" % (f,) for f in far]
else:
    print("(set COAST_PTS=path/to/coast_pts.npy to also run the distance-to-coast test)")

sec("4. Spot checks vs reference coordinates (tolerance 0.1 deg lat AND lon)")
PORT_ORACLE = [  # label, name regex, country, lat, lon
    ("Mundra", r"^mundra$", "IN", 22.74, 69.70), ("JNPT", r"jawaharlal|nhava", "IN", 18.95, 72.95), ("Rotterdam", r"^rotterdam$", "NL", 51.95, 4.14),
    ("Chennai", r"^chennai", "IN", 13.08, 80.29), ("Colombo", r"^colombo$", "LK", 6.95, 79.85), ("Jebel Ali", r"jabal ali|jebel ali", "AE", 25.00, 55.06),
    ("Singapore", r"singapore", "SG", 1.26, 103.84), ("Shanghai", r"^shanghai$", "CN", 31.23, 121.47), ("Hamburg", r"^hamburg$", "DE", 53.54, 9.97),
    ("Los Angeles", r"^los angeles$", "US", 33.73, -118.26), ("Busan", r"^busan$", "KR", 35.10, 129.04), ("Kochi", r"^kochi", "IN", 9.97, 76.27),
    ("Visakhapatnam", r"vishakhapatnam|visakhapatnam", "IN", 17.69, 83.29), ("Antwerp", r"^antwerp", "BE", 51.27, 4.34), ("Port Klang", r"^port klang$", "MY", 3.00, 101.39),
    ("Karachi", r"^karachi$", "PK", 24.84, 66.98), ("Haldia", r"^haldia", "IN", 22.03, 88.07), ("Kandla", r"^kandla$", "IN", 23.03, 70.22),
]
AIR_ORACLE = [("DEL", 28.556, 77.100), ("BOM", 19.089, 72.868), ("FRA", 50.038, 8.562), ("LHR", 51.470, -0.454), ("JFK", 40.641, -73.778), ("SIN", 1.364, 103.991),
              ("DXB", 25.253, 55.366), ("HKG", 22.308, 113.918), ("MAA", 12.994, 80.171), ("BLR", 13.199, 77.707), ("CCU", 22.655, 88.447), ("HYD", 17.240, 78.429),
              ("PVG", 31.144, 121.808), ("MEM", 35.042, -89.977), ("CDG", 49.010, 2.548)]
tot = dev = miss = 0
for lab, rx, cc, la, lo in PORT_ORACLE:
    c = [r for r in ports if r[1] == cc and re.search(rx, r[0], re.I)]
    tot += 1
    if not c: miss += 1; print("  MISSING  port %-14s (no row matches /%s/ in %s)" % (lab, rx, cc)); continue
    r = min(c, key=lambda r: hav(r[2], r[3], la, lo)); dl, dn = abs(r[2] - la), abs(r[3] - lo)
    flag = "OK       " if dl <= 0.1 and dn <= 0.1 else "DEVIATION"; dev += flag.startswith("DEV")
    print("  %s port %-14s row=%-38s file=(%.2f,%.2f) ref=(%.2f,%.2f) dlat=%.2f dlon=%.2f dist=%.1f km" % (flag, lab, r[0][:38], r[2], r[3], la, lo, dl, dn, hav(r[2], r[3], la, lo)))
for iata, la, lo in AIR_ORACLE:
    c = [r for r in air if r[4] == iata]; tot += 1
    if not c: miss += 1; print("  MISSING  airport %s" % iata); continue
    r = c[0]; dl, dn = abs(r[2] - la), abs(r[3] - lo)
    flag = "OK       " if dl <= 0.1 and dn <= 0.1 else "DEVIATION"; dev += flag.startswith("DEV")
    print("  %s airport %-4s row=%-30s file=(%.2f,%.2f) ref=(%.3f,%.3f) dlat=%.2f dlon=%.2f" % (flag, iata, r[0][:30], r[2], r[3], la, lo, dl, dn))
print("spot checks: %d total, %d deviations >0.1 deg, %d missing from file" % (tot, dev, miss))
warns += ["%d spot-check deviations > 0.1 deg" % dev] if dev else []

sec("5. Coverage assertions")
need_air = {"DEL", "BOM", "MAA", "BLR", "CCU", "HYD", "AMD", "COK", "GOI", "PNQ", "JAI", "LKO", "VNS", "IXZ"}
print("Indian IATA sanity set missing from airports.json:", sorted(need_air - {r[4] for r in air}))
print("Indian ports rows:", sum(1 for r in ports if r[1] == "IN"), "| Indian airports rows:", sum(1 for r in air if r[1] == "IN"))
named = ["Tughlakabad", "Dadri", "Khodiyar", "Sanand", "Kanakpura", "Dhandarikalan", "MIHAN", "Patparganj", "Pithampur", "Varanasi", "Haldia"]
for n in named: print("  surface contains %-12s %s" % (n, "yes" if any(n.lower() in r[0].lower() for r in sur) else "NO"))
regions = {"South Asia": "IN PK BD LK MV NP".split(), "SE Asia": "ID MY TH VN PH SG KH MM".split(), "Middle East": "AE SA OM QA KW BH IR IQ".split(),
           "East Africa": "KE TZ MZ MG SO DJ".split(), "Europe": "GB FR ES IT GR DE NL BE DK NO SE FI PL RO BG HR".split()}
for k, v in regions.items(): print("  %-12s ports: %s" % (k, ", ".join("%s=%d" % (c, sum(1 for r in ports if r[1] == c)) for c in v)))

sec("RESULT")
print("HARD FAILURES: %d" % len(fails)); [print("  FAIL", f) for f in fails[:50]]
print("WARNINGS: %d" % len(warns)); [print("  WARN", w) for w in warns[:50]]
sys.exit(1 if fails else 0)
