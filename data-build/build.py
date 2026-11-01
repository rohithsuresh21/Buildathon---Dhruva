#!/usr/bin/env python3
"""Build ports.json, airports.json, india-surface.json (+ row-level sidecars) for Landfall.

Usage: python3 -I build.py RAW_DIR OUT_DIR
RAW_DIR must hold (see fetch.sh):
  wpi_all.json                (dump of NGA WPI via npm seaport-data-js@1.0.1)
  unlocode.csv, subdiv.csv    (github datasets/un-locode)
  airports.csv, runways.csv   (github davidmegginson/ourairports-data)
  stations.json, schedules.json (github datameet/railways)
  coast_pts.npy               (densified Natural Earth 10m coastline, lat/lon)
Only real source rows are emitted; nothing is typed in from memory except the
*selection lists* (which named node maps to which source row), documented below.
"""
import csv, json, math, os, re, sys, collections
import numpy as np
from scipy.spatial import cKDTree

RAW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
P = lambda f: os.path.join(RAW, f)
dump = lambda o: json.dumps(o, separators=(",", ":"), ensure_ascii=False)
stats = collections.OrderedDict()


def hav(a, b, c, d):
    R = 6371.0
    p1, p2 = math.radians(a), math.radians(c)
    dl = math.radians(d - b); dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def xyz(la, lo):
    la = np.radians(la); lo = np.radians(lo)
    return np.c_[np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]


coast = np.load(P("coast_pts.npy"))
CT = cKDTree(xyz(coast[:, 0], coast[:, 1]))
coast_km = lambda la, lo: float(CT.query(xyz(np.array([la]), np.array([lo]))[0])[0] * 6371)


def unl_coord(c):
    if not c:
        return None
    a, b = c.split()
    lat = int(a[:-1][:2]) + int(a[:-1][2:]) / 60
    lon = int(b[:-1][:3]) + int(b[:-1][3:]) / 60
    return (-lat if a[-1] == "S" else lat, -lon if b[-1] == "W" else lon)


# ----------------------------------------------------------------------------
# PORTS
# ----------------------------------------------------------------------------
wpi = json.load(open(P("wpi_all.json")))
stats["wpi_rows"] = len(wpi)
unl = list(csv.DictReader(open(P("unlocode.csv"), encoding="utf-8")))
stats["unlocode_rows"] = len(unl)
unl_by_code = {}
for r in unl:
    unl_by_code.setdefault(r["Country"] + r["Location"], []).append(r)


def score(p):
    s = {"Large": 3, "Medium": 2, "Small": 1}.get(p["harbor_size"], 0)
    if p["facility_container"] or p["crane_container"]: s += 1.5
    pd = p["cargo_pier_depth_m"] or 0
    s += 1.5 if pd >= 15 else 1.0 if pd >= 12 else 0.5 if pd >= 9 else 0
    ml = p["max_vessel_length_m"] or 0
    s += 1.0 if ml >= 300 else 0.5 if ml >= 200 else 0
    cd = p["channel_depth_m"] or 0
    s += 0.5 if cd >= 10 else 0
    if p["harbor_use"] == "Cargo": s += 0.5
    elif p["harbor_use"] in ("Fishing", "Military"): s -= 1
    if p["facility_oil_terminal"] or p["facility_lng_terminal"]: s += 0.5
    return s


def cls(p, s):
    c = 3 if s >= 5 else 2 if s >= 3 else 1 if s >= 1.5 else 0
    if p["harbor_size"] == "Large": c = max(c, 2)
    return c


rows = []
for p in wpi:
    if p["latitude"] is None or p["longitude"] is None: continue
    s = score(p)
    rows.append(dict(name=p["name"].strip(), cc=p["country_code"], lat=p["latitude"], lon=p["longitude"],
                     loc=p["locode"] or "", s=s, c=cls(p, s), src="WPI", hs=p["harbor_size"], reg=p["region"] or ""))
# fix duplicated LOCODE in WPI (e.g. Krishnapatnam carries Kattupalli's INKRI): keep first, blank later dups
seen = collections.Counter(r["loc"] for r in rows if r["loc"])
fixed = []
for r in rows:
    if r["loc"] and seen[r["loc"]] > 1:
        # resolve by name against UN/LOCODE
        cand = [u for u in unl_by_code.get(r["loc"], [])]
        nm = r["name"].lower().split()[0]
        if not any(nm in (u["NameWoDiacritics"] or "").lower() for u in cand):
            fixed.append((r["name"], r["loc"])); r["loc"] = ""
stats["wpi_duplicate_locodes_blanked"] = fixed

# --- India supplement from UN/LOCODE (function 1 = port, coordinates present) ---
in_wpi = [r for r in rows if r["cc"] == "IN"]
sub = {(r["SUCountry"], r["SUCode"]): r["SUName"] for r in csv.DictReader(open(P("subdiv.csv"), encoding="utf-8"))}
cands, added, rejected = [], [], []
for u in unl:
    if u["Country"] != "IN" or u["Function"][:1] != "1" or not u["Coordinates"]: continue
    if u["Change"] == "X": continue
    la, lo = unl_coord(u["Coordinates"])
    code = "IN" + u["Location"]
    nearest = min(hav(la, lo, r["lat"], r["lon"]) for r in in_wpi)
    ck = coast_km(la, lo)
    rec = (code, u["NameWoDiacritics"], u["Subdivision"], round(la, 3), round(lo, 3), round(nearest, 1), round(ck, 1), u["Status"])
    if code in {r["loc"] for r in in_wpi if r.get("loc")}: rejected.append(rec + ("LOCODE already present from WPI",)); continue
    if nearest <= 10: rejected.append(rec + ("within 10 km of existing WPI India port",)); continue
    if re.search(r"icd|cfs|sez", u["Name"] + " " + u["Remarks"], re.I): rejected.append(rec + ("ICD/CFS/SEZ entry, goes to surface file",)); continue
    if ck > (5 if u["Status"] == "RL" else 12): rejected.append(rec + ("not on coast/estuary (>%d km from coastline; RL status needs <=5, approved <=12)" % (5 if u["Status"] == "RL" else 12),)); continue
    added.append(rec)
    in_wpi.append(dict(lat=la, lon=lo))
    rows.append(dict(name=u["NameWoDiacritics"].strip(), cc="IN", lat=la, lon=lo, loc=code, s=1.5, c=1, src="UNLOCODE", hs=None, reg="India"))
stats["india_unlocode_added"] = added
stats["india_unlocode_rejected"] = rejected

# --- selection ---
idx_in = [r for r in rows if r["cc"] == "IN"]
others = [r for r in rows if r["cc"] != "IN"]
others.sort(key=lambda r: (-r["s"], r["name"]))
chosen = {id(r) for r in idx_in}
# regional floors: per-country minimum (top n by score)
FLOOR_REG = {  # ISO2 -> minimum ports kept (regions the brief names explicitly)
    **{c: 25 for c in "PK BD LK MV NP MM".split()},                                   # South Asia + Myanmar
    **{c: 20 for c in "ID MY TH VN PH SG KH BN TL".split()},                          # SE Asia
    **{c: 14 for c in "AE SA OM QA KW BH IR IQ YE JO IL EG TR".split()},              # Middle East (+Egypt/Turkey)
    **{c: 14 for c in "KE TZ MZ MG SO DJ ER SD MU SC KM".split()},                    # East Africa / W Indian Ocean
}
EUROPE = "GB IE FR ES PT IT GR HR SI AL ME DE NL BE DK NO SE FI EE LV LT PL RO BG UA RU CY MT IS".split()
FLOOR_REG.update({c: 12 for c in EUROPE})
bycc = collections.defaultdict(list)
for r in others: bycc[r["cc"]].append(r)
for c, lst in bycc.items():
    n = FLOOR_REG.get(c, 3)
    for r in lst[:n]: chosen.add(id(r))
TARGET_OTHERS = 1100
cur = sum(1 for r in others if id(r) in chosen)
for r in others:
    if cur >= TARGET_OTHERS: break
    if id(r) not in chosen: chosen.add(id(r)); cur += 1
sel = [r for r in rows if id(r) in chosen]
stats["ports_selected_before_cap"] = len(sel)


def prow(r):
    return [r["name"], r["cc"], round(r["lat"], 2), round(r["lon"], 2), r["c"], r["loc"]]


CAP = 70 * 1024
sel.sort(key=lambda r: (r["cc"] != "IN", -r["c"], -r["s"], r["name"]))
cut = 0
while len(dump([prow(r) for r in sel]).encode()) > CAP:
    # cut lowest class, lowest score, non-India first
    cand = [r for r in sel if r["cc"] != "IN"]
    worst = min(cand, key=lambda r: (r["c"], r["s"], r["name"]))
    sel.remove(worst); cut += 1
stats["ports_cut_for_cap"] = cut
sel.sort(key=lambda r: (r["cc"], -r["c"], r["name"]))
out_ports = [prow(r) for r in sel]
open(os.path.join(OUT, "ports.json"), "w", encoding="utf-8").write(dump(out_ports))
open(os.path.join(OUT, "ports.sources.json"), "w", encoding="utf-8").write(dump(
    [[r["name"], r["cc"], r["src"], r["hs"], round(r["s"], 1)] for r in sel]))
stats["ports_rows"] = len(out_ports)
stats["ports_india_rows"] = sum(1 for r in sel if r["cc"] == "IN")
stats["ports_class_counts"] = dict(collections.Counter(r["c"] for r in sel))

# ----------------------------------------------------------------------------
# AIRPORTS
# ----------------------------------------------------------------------------
air = list(csv.DictReader(open(P("airports.csv"), encoding="utf-8")))
stats["ourairports_rows"] = len(air)
rw = collections.defaultdict(int)
for r in csv.DictReader(open(P("runways.csv"), encoding="utf-8")):
    try: rw[r["airport_ident"]] = max(rw[r["airport_ident"]], int(float(r["length_ft"] or 0)))
    except ValueError: pass
TYPE = {"large_airport": 3, "medium_airport": 2, "small_airport": 1}
routes = collections.Counter()  # OpenFlights routes.dat: route count per IATA (used for RANKING only)
for r in csv.reader(open(P("routes.dat"), encoding="utf-8")):
    routes[r[2]] += 1; routes[r[4]] += 1
cand = []
for a in air:
    if a["scheduled_service"] != "yes" or not a["iata_code"] or a["type"] not in TYPE: continue
    rl = rw.get(a["ident"], 0)
    cand.append(dict(name=a["name"], cc=a["iso_country"], lat=float(a["latitude_deg"]), lon=float(a["longitude_deg"]),
                     iata=a["iata_code"], icao=a["icao_code"] or (a["ident"] if re.fullmatch(r"[A-Z]{4}", a["ident"]) else ""),
                     c=TYPE[a["type"]], rl=rl, nr=routes.get(a["iata_code"], 0)))
for a in cand:  # sizeClass: OurAirports type refined by route connectivity
    a["c"] = 3 if (a["c"] == 3 and a["nr"] >= 100) else 2 if (a["c"] == 3 or (a["c"] == 2 and a["nr"] >= 30)) else 1 if a["c"] >= 1 and (a["nr"] >= 5 or a["c"] == 2) else 0
stats["airports_scheduled_with_iata"] = len(cand)


def short(n):
    n2 = re.sub(r"\s+(International|Int'l|Intl)?\s*Airport$", "", n.strip(), flags=re.I)
    n2 = re.sub(r"\s+Airport$", "", n2, flags=re.I)
    return n2 or n


def arow(a):
    return [short(a["name"]), a["cc"], round(a["lat"], 2), round(a["lon"], 2), a["iata"], a["icao"], a["c"]]


def pri(a):  # lower = keep first
    if a["cc"] == "IN": return (0, -a["nr"], -a["rl"])
    return (1, -a["nr"], -a["rl"])


cand.sort(key=pri)
CAPA = 45 * 1024
keep = []
size = 2
for a in cand:
    s = len(dump(arow(a)).encode()) + 1
    if size + s > CAPA: continue
    keep.append(a); size += s
keep.sort(key=lambda a: (a["cc"], -a["c"], a["name"]))
open(os.path.join(OUT, "airports.json"), "w", encoding="utf-8").write(dump([arow(a) for a in keep]))
stats["airports_rows"] = len(keep)
stats["airports_india_rows"] = sum(1 for a in keep if a["cc"] == "IN")
stats["airports_india_candidates"] = sum(1 for a in cand if a["cc"] == "IN")
stats["airports_class_counts"] = dict(collections.Counter(a["c"] for a in keep))
stats["airports_dropped_for_cap"] = len(cand) - len(keep)
stats["airports_large_dropped"] = sum(1 for a in cand if a["c"] == 3 and a not in keep)
stats["airports_no_routes_in_cand"] = sum(1 for a in cand if a["nr"] == 0)

# ----------------------------------------------------------------------------
# INDIA SURFACE
# ----------------------------------------------------------------------------
st = json.load(open(P("stations.json")))["features"]
S = {f["properties"]["code"]: f for f in st if f["geometry"]}
tc = collections.defaultdict(set)
for s in json.load(open(P("schedules.json"))): tc[s["station_code"]].add(s["train_number"])
# state lookup: nearest station that has a state (datameet), border-unsafe -> documented
withstate = [(f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0], f["properties"]["state"]) for f in S.values() if f["properties"]["state"]]
ST = cKDTree(xyz(np.array([x[0] for x in withstate]), np.array([x[1] for x in withstate])))


def state_of(la, lo):
    d, i = ST.query(xyz(np.array([la]), np.array([lo]))[0])
    return withstate[i][2], d * 6371


def su_state(code):
    n = sub.get(("IN", code), "")
    return n or None


import unicodedata
def norm_state(x):
    if not x: return x
    x = "".join(ch for ch in unicodedata.normalize("NFKD", x) if not unicodedata.combining(ch))
    return {"Orissa": "Odisha", "Chattisgarh": "Chhattisgarh", "Uttaranchal": "Uttarakhand", "Pondicherry": "Puducherry"}.get(x, x)


land = json.load(open(P("ne_10m_land.geojson")))
LANDPOLY = []
for f in land["features"]:
    g = f["geometry"]
    for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
        ring = np.array(poly[0]); LANDPOLY.append((ring[:, 0].min(), ring[:, 0].max(), ring[:, 1].min(), ring[:, 1].max(), ring))


def on_land(la, lo):
    for x0, x1, y0, y1, ring in LANDPOLY:
        if x0 <= lo <= x1 and y0 <= la <= y1:
            xs, ys = ring[:, 0], ring[:, 1]
            x2, y2 = np.roll(xs, -1), np.roll(ys, -1)
            m = ((ys > la) != (y2 > la)) & (lo < (x2 - xs) * (la - ys) / (y2 - ys + 1e-18) + xs)
            if m.sum() % 2 == 1: return True
    return False


adm = json.load(open(P("ne_10m_admin1.geojson")))
STATEPOLY = []
for f in adm["features"]:
    if f["properties"].get("iso_a2") != "IN": continue
    g = f["geometry"]
    for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
        ring = np.array(poly[0]); STATEPOLY.append((f["properties"]["name"], ring[:, 0].min(), ring[:, 0].max(), ring[:, 1].min(), ring[:, 1].max(), ring))


def state_poly(la, lo):
    for nm, x0, x1, y0, y1, ring in STATEPOLY:
        if x0 <= lo <= x1 and y0 <= la <= y1:
            xs, ys = ring[:, 0], ring[:, 1]
            x2, y2 = np.roll(xs, -1), np.roll(ys, -1)
            m = ((ys > la) != (y2 > la)) & (lo < (x2 - xs) * (la - ys) / (y2 - ys + 1e-18) + xs)
            if m.sum() % 2 == 1: return nm, 0.0
    best = min(((float(np.min(np.hypot(ring[:, 1] - la, (ring[:, 0] - lo) * math.cos(math.radians(la))))) * 111, nm) for nm, *_r, ring in STATEPOLY))
    return best[1], best[0]


state_mismatch = []
surf, src_log, disagreements, offland = [], [], [], []


def add(name, kind, state, la, lo, src, note=""):
    state = norm_state(state)
    ps, dkm = state_poly(la, lo)
    if state and state != ps: state_mismatch.append((name, state, ps, round(dkm, 1)))
    if dkm <= 25 and state != "Delhi": state = ps  # Delhi: border cases (e.g. Tughlakabad) keep the UN/LOCODE subdivision
    if src.startswith("UN/LOCODE") and not on_land(la, lo):
        offland.append((name, round(la, 3), round(lo, 3), src)); return
    surf.append([name, kind, state, round(la, 2), round(lo, 2)])
    src_log.append([name, src, note])


# (a) user-named ICDs: (display name, UN/LOCODE location code, datameet station code)
NAMED = [
    ("Tughlakabad ICD", "TKD", "TKD"), ("Dadri ICD", "DER", "DER"), ("Patparganj ICD", "PPG", None),
    ("Khodiyar ICD", "KHO", "KHD"), ("Sanand ICD", "SAA", "SAU"), ("Pithampur ICD", "PIR", None),
    ("Jaipur-Kanakpura ICD", "KKU", "KKU"), ("Dhandarikalan ICD (Ludhiana)", "DDL", "DDL"),
    ("MIHAN ICD (Nagpur)", "KPK", None), ("Varanasi ICD", "VNS", "BSB"),
]
named_pts, dropped_named = [], []
for nm, ul, dm in NAMED:
    urow = next((u for u in unl if u["Country"] == "IN" and u["Location"] == ul and u["Coordinates"]), None)
    ucoord = unl_coord(urow["Coordinates"]) if urow else None
    scoord = (S[dm]["geometry"]["coordinates"][1], S[dm]["geometry"]["coordinates"][0]) if dm and dm in S else None
    if ucoord and scoord:
        dd = hav(*ucoord, *scoord)
        if dd > 10: disagreements.append((nm, round(dd, 1), ucoord, scoord))
    if not (ucoord or scoord):
        dropped_named.append(nm); continue
    # prefer datameet station geometry (precise); fall back to UN/LOCODE (1 arc-minute)
    la, lo = scoord if scoord else ucoord
    state = (S[dm]["properties"]["state"] if scoord else None) or (su_state(urow["Subdivision"]) if urow else None) or state_of(la, lo)[0]
    if urow and urow["Subdivision"]: state = su_state(urow["Subdivision"]) or state
    add(nm, "icd", state, la, lo, "datameet/railways station %s" % dm if scoord else "UN/LOCODE IN%s" % ul,
        "UN/LOCODE coord disagreed >10km, station used" if (ucoord and scoord and hav(*ucoord, *scoord) > 10) else "")
    named_pts.append((la, lo))
stats["surface_named_dropped_no_coordinate_source"] = dropped_named
stats["surface_named_coord_disagreements_km"] = disagreements

# (b) rule-based: UN/LOCODE India rows with coordinates whose Name/Remarks say ICD or CFS
cfs_groups = collections.OrderedDict()
for u in unl:
    if u["Country"] != "IN" or not u["Coordinates"] or u["Change"] == "X": continue
    t = u["Name"] + " " + u["Remarks"]
    if re.search(r"\bsez\b", u["Name"], re.I) and not re.search(r"icd|cfs", t, re.I): continue
    isicd = re.search(r"\bicd\b", t, re.I); iscfs = re.search(r"\bcfs\b", u["Name"], re.I)
    if not (isicd or iscfs or re.search(r"container terminal", u["Name"], re.I)): continue
    la, lo = unl_coord(u["Coordinates"])
    if any(hav(la, lo, a, b) < 6 for a, b in named_pts) and not iscfs: continue
    state = su_state(u["Subdivision"]) or state_of(la, lo)[0]
    nm = u["NameWoDiacritics"].strip()
    if iscfs and not isicd:
        cfs_groups.setdefault((round(la, 3), round(lo, 3)), []).append((nm, state, u["Location"]))
    elif re.search(r"container terminal", nm, re.I) and not isicd:
        add(nm, "rail_terminal", state, la, lo, "UN/LOCODE IN" + u["Location"], "name contains 'Container Terminal'")
    else:
        if not re.search(r"\bicd\b", nm, re.I): nm = nm + " ICD/CFS"
        add(nm, "icd", state, la, lo, "UN/LOCODE IN" + u["Location"], u["Remarks"])
for (la, lo), g in cfs_groups.items():
    if len(g) == 1: add(g[0][0], "cfs", g[0][1], la, lo, "UN/LOCODE IN" + g[0][2])
    else:
        place = g[0][0].split("/")[-1]
        add("%s CFS cluster (%d operators)" % (place, len(g)), "cfs", g[0][1], la, lo,
            "UN/LOCODE " + ",".join("IN" + x[2] for x in g), "identical coordinates collapsed")

# (c) freight yards named in datameet stations
pat = re.compile(r"GOODS|MARSHAL|EXCHANGE YARD|THROUGH YARD|\bR YARD|VARANASI YARD", re.I)
bad = re.compile(r"COACHING|CABIN|SORTING|SIDING", re.I)
for c, f in S.items():
    n = f["properties"]["name"]
    if pat.search(n) and not bad.search(n):
        la, lo = f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0]
        stt = f["properties"]["state"] or state_of(la, lo)[0]
        add(n.title().replace("Marshaling", "Marshalling"), "rail_terminal", stt, la, lo, "datameet/railways station " + c, "freight yard by station name")

# (d) river ports from WPI (Hooghly) as inland_port
for p in wpi:
    if p["country_code"] == "IN" and (p["harbor_type"] or "").startswith("River") and p["name"] in ("Haldia Port", "Calcutta"):
        add(p["name"].replace("Calcutta", "Kolkata (Syama Prasad Mookerjee Port)"), "inland_port", "West Bengal",
            p["latitude"], p["longitude"], "NGA WPI #%s" % p["wpi_number"], "WPI harbor_type=%s" % p["harbor_type"])

# (e) junctions: station name contains JN and >=100 distinct scheduled trains
nj = 0
for c, f in sorted(S.items(), key=lambda kv: -len(tc.get(kv[0], ()))):
    n = f["properties"]["name"]
    if re.search(r"\bJN\b|JUNCTION", n, re.I) and len(tc.get(c, ())) >= 100:
        la, lo = f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0]
        stt = f["properties"]["state"] or state_of(la, lo)[0]
        nm = re.sub(r"\s+JN$", " Jn", n.title(), flags=re.I)
        add(nm, "junction", stt, la, lo, "datameet/railways station %s" % c, "%d scheduled trains" % len(tc[c])); nj += 1
stats["surface_junctions"] = nj

# dedupe (same name within 5 km), then cap 25 KB (drop junctions with fewest trains first, then cfs)
final, log2, collapsed = [], [], []
for r, l in zip(surf, src_log):
    if any((r[0].lower() == q[0].lower() and hav(r[3], r[4], q[3], q[4]) < 5) or (r[1] == q[1] and r[1] in ("icd", "rail_terminal") and hav(r[3], r[4], q[3], q[4]) < 1.0) for q in final): collapsed.append(r[0]); continue
    final.append(r); log2.append(l)
order = {"icd": 0, "inland_port": 1, "rail_terminal": 2, "cfs": 3, "dry_port": 4, "junction": 5}
CAPS = 25 * 1024
while len(dump(final).encode()) > CAPS:
    j = max((i for i, r in enumerate(final) if r[1] in ("junction", "cfs")), key=lambda i: (final[i][1] == "junction", i))
    final.pop(j); log2.pop(j)
pairs = sorted(zip(final, log2), key=lambda x: (order[x[0][1]], x[0][2] or "", x[0][0]))
final = [p[0] for p in pairs]; log2 = [p[1] for p in pairs]
open(os.path.join(OUT, "india-surface.json"), "w", encoding="utf-8").write(dump(final))
open(os.path.join(OUT, "india-surface.sources.json"), "w", encoding="utf-8").write(dump([f + l[1:] for f, l in zip(final, log2)]))
stats["surface_rows"] = len(final)
stats["surface_state_source_vs_polygon_mismatches"] = state_mismatch
stats["surface_dropped_offland_unlocode_points"] = offland
stats["surface_collapsed_same_site_within_1km"] = collapsed
stats["surface_kind_counts"] = dict(collections.Counter(r[1] for r in final))
stats["surface_null_state"] = sum(1 for r in final if not r[2])
json.dump(stats, open(os.path.join(OUT, "build-stats.json"), "w"), indent=1, ensure_ascii=False, default=str)
print(json.dumps(stats, indent=1, ensure_ascii=False, default=str))
for f in ("ports.json", "airports.json", "india-surface.json"):
    print(f, os.path.getsize(os.path.join(OUT, f)), "bytes")
