import { haversineKm, pathLengthKm, type LonLat } from "./geo";

/**
 * A curated maritime waypoint graph. Coordinates are real sea positions along the
 * principal deep-sea lanes; edges are sea passages. It is a planning approximation,
 * not an electronic navigational chart: the agent labels route lengths as estimates.
 */

export interface SeaNode {
  id: string;
  lon: number;
  lat: number;
  /** Set for chokepoints: label shown in UI and key used to match IMF PortWatch records */
  chokepoint?: { key: string; name: string };
}

const N: [string, number, number, ([string, string] | undefined)?][] = [
  // East Asia
  ["ecs", 123.5, 30.0], ["yellow_sea", 122.5, 36.0], ["bohai", 120.5, 38.4], ["jeju_s", 126.5, 33.0],
  ["korea_st", 129.3, 34.2, ["korea", "Korea Strait"]], ["taiwan_st", 119.6, 24.3, ["taiwan", "Taiwan Strait"]],
  ["hk_appr", 114.6, 21.6], ["scs_n", 114.0, 17.0], ["scs_c", 111.5, 11.0], ["hainan_s", 110.5, 17.0],
  ["gt_mid", 108.0, 18.2], ["haiphong_appr", 107.4, 20.2], ["vungtau", 107.8, 9.9], ["ca_mau_off", 104.2, 6.8],
  ["gulf_thai", 101.5, 12.3], ["natuna", 108.5, 5.0], ["karimata", 108.5, -2.5], ["java_sea", 106.5, -5.0],
  ["ryukyu", 128.5, 28.0],
  // Malacca & Bay of Bengal
  ["sing_e", 104.6, 1.4], ["sing_strait", 103.8, 1.15], ["malacca", 101.6, 2.6, ["malacca", "Malacca Strait"]],
  ["malacca_n", 98.0, 5.9], ["andaman", 94.0, 6.5], ["sl_s", 80.3, 5.2], ["colombo_appr", 79.6, 6.8],
  ["cape_comorin", 77.4, 7.0], ["bay_c", 86.0, 9.5], ["chennai_appr", 81.0, 13.1], ["vizag_appr", 84.1, 17.4],
  ["paradip_appr", 87.2, 19.8], ["sagar_roads", 88.3, 20.9], ["chittagong_appr", 91.6, 21.7],
  // India west coast
  ["tuticorin_appr", 78.3, 8.6], ["kochi_appr", 75.9, 9.8], ["mangalore_appr", 74.4, 12.9], ["goa_off", 72.9, 15.2],
  ["mumbai_appr", 72.6, 18.8], ["hazira_appr", 72.3, 20.8], ["diu_off", 70.8, 20.2], ["porbandar_off", 68.9, 21.3],
  ["okha", 68.6, 22.3], ["mundra_appr", 69.4, 22.6], ["kandla_appr", 69.9, 22.8],
  // Arabian Sea, Gulf of Oman, Persian Gulf
  ["arab_mid", 66.0, 14.0], ["arab_c", 60.0, 13.5], ["arab_n", 64.0, 21.0], ["arab_ne", 61.0, 23.2],
  ["gulf_oman", 58.3, 25.0], ["hormuz", 56.6, 26.5, ["hormuz", "Strait of Hormuz"]], ["persian", 52.5, 27.3],
  ["jebel_appr", 54.8, 25.8], ["persian_w", 50.4, 26.9], ["salalah_appr", 54.0, 16.2],
  ["gulf_aden_e", 52.0, 12.4], ["gulf_aden", 47.0, 12.0],
  // Red Sea & Suez
  ["bab", 43.3, 12.6, ["babelmandeb", "Bab el-Mandeb Strait"]], ["red_1", 42.0, 14.2], ["red_2", 40.0, 17.8],
  ["jeddah_appr", 38.6, 21.4], ["red_3", 37.0, 23.8], ["red_4", 35.5, 26.8], ["red_5", 33.6, 28.2],
  ["suez", 32.55, 30.0, ["suez", "Suez Canal"]], ["port_said", 32.35, 31.4],
  // Mediterranean
  ["med_e", 30.5, 33.0], ["crete_s", 25.0, 34.4], ["piraeus_appr", 23.8, 37.6], ["malta_s", 14.5, 35.5],
  ["sicily", 11.9, 37.4], ["tyrrh", 11.8, 40.0], ["ligurian", 8.5, 43.2], ["med_w", 3.0, 38.3],
  ["gibraltar", -5.5, 35.95, ["gibraltar", "Strait of Gibraltar"]],
  // Atlantic & North Europe
  ["atl_pt", -9.8, 36.6], ["finisterre", -10.0, 43.2], ["wchannel", -6.0, 48.8], ["channel_mid", -3.0, 50.0],
  ["dover", 1.4, 51.0, ["dover", "Dover Strait"]], ["north_sea_s", 3.2, 52.0], ["elbe_appr", 7.5, 54.2],
  ["atl_mid", -40.0, 36.0], ["atl_n", -30.0, 47.0], ["ny_appr", -73.0, 39.8], ["savannah_appr", -80.5, 31.8],
  ["fl_e", -78.8, 27.5], ["florida_st", -79.5, 25.3], ["gulf_mex1", -84.5, 24.0], ["gulf_mex", -90.0, 26.5],
  ["houston_appr", -94.3, 29.1],
  // Africa
  ["somali_e", 52.0, 5.0], ["mombasa_appr", 41.5, -4.0], ["tanz", 41.0, -10.5],
  ["moz_ch", 41.0, -16.0, ["mozambique", "Mozambique Channel"]], ["moz_s", 37.5, -26.0],
  ["durban_appr", 32.5, -29.8], ["ec_off", 28.5, -34.0], ["pe_off", 25.5, -35.2], ["cape_ag", 20.0, -35.6],
  ["cape_gh", 17.5, -35.0, ["capegoodhope", "Cape of Good Hope"]], ["angola_off", 8.0, -17.0], ["guinea", 3.0, 2.0],
  ["lagos_appr", 3.3, 5.8], ["wafrica1", -5.0, 3.5], ["wafrica2", -14.0, 8.0], ["dakar_off", -19.0, 13.5],
  ["canary", -17.5, 28.0], ["io_c", 75.0, -6.0], ["io_sw", 55.0, -26.0], ["se_afr", 30.0, -36.5],
  // Pacific
  ["pac1", 145.0, 31.0], ["pac2", -175.0, 41.0], ["pac3", -140.0, 37.0], ["la_appr", -118.8, 33.5],
];

const E: [string, string][] = [
  ["hk_appr", "taiwan_st"], ["taiwan_st", "ecs"], ["ecs", "korea_st"], ["ecs", "yellow_sea"], ["yellow_sea", "bohai"],
  ["yellow_sea", "jeju_s"], ["jeju_s", "korea_st"], ["ecs", "ryukyu"], ["ryukyu", "pac1"], ["korea_st", "pac1"],
  ["pac1", "pac2"], ["pac2", "pac3"], ["pac3", "la_appr"],
  ["hk_appr", "scs_n"], ["scs_n", "scs_c"], ["scs_n", "hainan_s"], ["hainan_s", "gt_mid"], ["gt_mid", "haiphong_appr"],
  ["scs_c", "vungtau"], ["scs_c", "natuna"], ["vungtau", "ca_mau_off"], ["natuna", "ca_mau_off"],
  ["ca_mau_off", "gulf_thai"], ["natuna", "sing_e"], ["natuna", "karimata"], ["karimata", "java_sea"], ["java_sea", "sing_e"],
  ["sing_e", "sing_strait"], ["sing_strait", "malacca"], ["malacca", "malacca_n"], ["malacca_n", "andaman"],
  ["andaman", "sl_s"], ["andaman", "bay_c"], ["sl_s", "bay_c"], ["sl_s", "colombo_appr"], ["colombo_appr", "cape_comorin"],
  ["cape_comorin", "tuticorin_appr"], ["bay_c", "chennai_appr"], ["sl_s", "chennai_appr"], ["chennai_appr", "vizag_appr"],
  ["vizag_appr", "paradip_appr"], ["paradip_appr", "sagar_roads"], ["sagar_roads", "chittagong_appr"],
  ["cape_comorin", "kochi_appr"], ["kochi_appr", "mangalore_appr"], ["mangalore_appr", "goa_off"], ["goa_off", "mumbai_appr"],
  ["mumbai_appr", "hazira_appr"], ["mumbai_appr", "diu_off"], ["hazira_appr", "diu_off"], ["diu_off", "porbandar_off"],
  ["porbandar_off", "okha"], ["okha", "mundra_appr"], ["mundra_appr", "kandla_appr"],
  ["goa_off", "arab_mid"], ["mumbai_appr", "arab_mid"], ["kochi_appr", "arab_mid"], ["diu_off", "arab_n"], ["okha", "arab_n"],
  ["arab_n", "arab_ne"], ["arab_n", "arab_mid"], ["arab_ne", "gulf_oman"], ["gulf_oman", "hormuz"], ["hormuz", "jebel_appr"],
  ["hormuz", "persian"], ["persian", "persian_w"], ["persian", "jebel_appr"], ["arab_mid", "arab_c"], ["arab_c", "salalah_appr"],
  ["salalah_appr", "gulf_aden_e"], ["arab_c", "gulf_aden_e"], ["gulf_aden_e", "gulf_aden"], ["gulf_aden", "bab"],
  ["cape_comorin", "arab_mid"], ["arab_ne", "arab_mid"],
  ["bab", "red_1"], ["red_1", "red_2"], ["red_2", "jeddah_appr"], ["jeddah_appr", "red_3"], ["red_3", "red_4"],
  ["red_4", "red_5"], ["red_5", "suez"], ["suez", "port_said"], ["port_said", "med_e"],
  ["med_e", "crete_s"], ["crete_s", "piraeus_appr"], ["crete_s", "malta_s"], ["malta_s", "sicily"], ["sicily", "med_w"],
  ["sicily", "tyrrh"], ["tyrrh", "ligurian"], ["med_w", "ligurian"], ["med_w", "gibraltar"],
  ["gibraltar", "atl_pt"], ["atl_pt", "finisterre"], ["finisterre", "wchannel"], ["wchannel", "channel_mid"],
  ["channel_mid", "dover"], ["dover", "north_sea_s"], ["north_sea_s", "elbe_appr"], ["wchannel", "atl_n"],
  ["atl_pt", "atl_mid"], ["atl_mid", "ny_appr"], ["atl_n", "ny_appr"], ["atl_mid", "savannah_appr"],
  ["savannah_appr", "fl_e"], ["fl_e", "florida_st"], ["florida_st", "gulf_mex1"], ["gulf_mex1", "gulf_mex"],
  ["gulf_mex", "houston_appr"],
  ["gulf_aden_e", "somali_e"], ["arab_mid", "somali_e"], ["somali_e", "mombasa_appr"], ["mombasa_appr", "tanz"],
  ["tanz", "moz_ch"], ["moz_ch", "moz_s"], ["moz_s", "durban_appr"], ["durban_appr", "ec_off"], ["ec_off", "pe_off"],
  ["pe_off", "cape_ag"], ["cape_ag", "cape_gh"], ["cape_gh", "angola_off"], ["angola_off", "guinea"],
  ["guinea", "lagos_appr"], ["guinea", "wafrica1"], ["wafrica1", "wafrica2"], ["wafrica2", "dakar_off"],
  ["dakar_off", "canary"], ["canary", "atl_pt"],
  ["sl_s", "io_c"], ["arab_mid", "io_c"], ["io_c", "io_sw"], ["io_sw", "se_afr"], ["se_afr", "cape_ag"],
  ["se_afr", "durban_appr"], ["dakar_off", "atl_mid"],
];

export const NODES: Record<string, SeaNode> = {};
for (const [id, lon, lat, cp] of N) NODES[id] = { id, lon, lat, chokepoint: cp ? { key: cp[0], name: cp[1] } : undefined };

const ADJ: Record<string, { to: string; km: number }[]> = {};
for (const id of Object.keys(NODES)) ADJ[id] = [];
for (const [a, b] of E) {
  if (!NODES[a] || !NODES[b]) throw new Error(`seagraph: unknown node in edge ${a}-${b}`);
  const km = haversineKm([NODES[a].lon, NODES[a].lat], [NODES[b].lon, NODES[b].lat]);
  ADJ[a].push({ to: b, km });
  ADJ[b].push({ to: a, km });
}

export interface SeaRoute {
  nodes: string[];
  path: LonLat[];
  km: number;
  nm: number;
  /** days at a 14-knot service speed, estimate only */
  days: number;
  chokepoints: { key: string; name: string; lon: number; lat: number }[];
}

export const SERVICE_KNOTS = 14;

export function shortestSea(from: string, to: string, avoid: Set<string> = new Set()): SeaRoute | null {
  if (!NODES[from] || !NODES[to]) return null;
  if (avoid.has(from) || avoid.has(to)) return null;
  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const q = new Set<string>();
  for (const id of Object.keys(NODES)) {
    dist[id] = Infinity;
    prev[id] = null;
    if (!avoid.has(id)) q.add(id);
  }
  dist[from] = 0;
  while (q.size) {
    let u: string | null = null;
    let best = Infinity;
    for (const id of q) {
      if (dist[id] < best) {
        best = dist[id];
        u = id;
      }
    }
    if (u === null || best === Infinity) break;
    q.delete(u);
    if (u === to) break;
    for (const e of ADJ[u]) {
      if (!q.has(e.to)) continue;
      const nd = dist[u] + e.km;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
      }
    }
  }
  if (dist[to] === Infinity) return null;
  const nodes: string[] = [];
  for (let c: string | null = to; c; c = prev[c]) nodes.unshift(c);
  return buildRoute(nodes);
}

export function buildRoute(nodes: string[], endpoints?: { start?: LonLat; end?: LonLat }): SeaRoute {
  const path: LonLat[] = nodes.map((id) => [NODES[id].lon, NODES[id].lat] as LonLat);
  if (endpoints?.start) path.unshift(endpoints.start);
  if (endpoints?.end) path.push(endpoints.end);
  const km = pathLengthKm(path);
  const chokepoints = nodes
    .map((id) => NODES[id])
    .filter((n) => n.chokepoint)
    .map((n) => ({ key: n.chokepoint!.key, name: n.chokepoint!.name, lon: n.lon, lat: n.lat }));
  return { nodes, path, km, nm: km / 1.852, days: km / 1.852 / SERVICE_KNOTS / 24, chokepoints };
}

export const CHOKEPOINT_LIST = Object.values(NODES)
  .filter((n) => n.chokepoint)
  .map((n) => ({ key: n.chokepoint!.key, name: n.chokepoint!.name, lon: n.lon, lat: n.lat, node: n.id }));
