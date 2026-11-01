#!/usr/bin/env bash
# Reproduces the raw inputs in $1 (default ./raw). Needs only npm registry + raw.githubusercontent.com.
set -euo pipefail
R="${1:-raw}"; mkdir -p "$R/npm" && cd "$R"
GH=https://raw.githubusercontent.com
curl -fsS $GH/datasets/un-locode/main/data/code-list.csv -o unlocode.csv
curl -fsS $GH/datasets/un-locode/main/data/subdivision-codes.csv -o subdiv.csv
curl -fsS $GH/davidmegginson/ourairports-data/main/airports.csv -o airports.csv
curl -fsS $GH/davidmegginson/ourairports-data/main/runways.csv -o runways.csv
curl -fsS $GH/jpatokal/openflights/master/data/routes.dat -o routes.dat
curl -fsS $GH/datameet/railways/master/stations.json -o stations.json
curl -fsS $GH/datameet/railways/master/schedules.json -o schedules.json
curl -fsS $GH/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson -o ne_10m_coastline.geojson
curl -fsS $GH/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson -o ne_10m_land.geojson
curl -fsS $GH/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson -o ne_10m_admin1.geojson
# NGA World Port Index via npm seaport-data-js@1.0.1 (lib embeds WPI; dump every country)
( cd npm && npm pack seaport-data-js@1.0.1 --silent && tar xzf seaport-data-js-1.0.1.tgz )
node -e '
const m=require("./npm/package/lib/index.js"),fs=require("fs");
(async()=>{const cs=new Set(fs.readFileSync("unlocode.csv","utf8").split("\n").slice(1).map(l=>l.split(",")[1]).filter(x=>x&&x.length==2));
const all=[];for(const k of cs){try{all.push(...await m.getPortsByCountryCode(k));}catch(e){}}
fs.writeFileSync("wpi_all.json",JSON.stringify(all));console.log("wpi rows",all.length)})()'
# densified coastline for distance tests
python3 -I - <<'P'
import json, numpy as np
g=json.load(open("ne_10m_coastline.geojson")); pts=[]
for f in g["features"]:
    gm=f["geometry"]; ls=gm["coordinates"] if gm["type"]=="MultiLineString" else [gm["coordinates"]]
    for l in ls:
        for a,b in zip(l,l[1:]):
            n=max(1,int(max(abs(a[0]-b[0]),abs(a[1]-b[1]))/0.01))
            for i in range(n+1):
                t=i/n; pts.append((a[1]+(b[1]-a[1])*t,a[0]+(b[0]-a[0])*t))
np.save("coast_pts.npy",np.array(pts))
P
echo done
