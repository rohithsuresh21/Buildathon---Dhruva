import type { Row } from "../gazetteer";

export const ROWS_B: Row[] = [
  // ---- South & West Asia ports
  ["colombo", "Colombo", "port", "LK", 6.95, 79.85, "colombo|कोलंबो|கொழும்பு|કોલંબો", { seaNode: "colombo_appr" }],
  ["chittagong", "Chattogram", "port", "BD", 22.31, 91.8, "chittagong|chattogram", { seaNode: "chittagong_appr" }],
  ["jebel_ali", "Jebel Ali (Dubai)", "port", "AE", 25.01, 55.06, "jebel ali|dubai port|dubai|जेबेल अली|દુબઈ|துபாய்|दुबई", { seaNode: "jebel_appr" }],
  ["salalah", "Salalah", "port", "OM", 16.95, 54.0, "salalah", { seaNode: "salalah_appr" }],
  ["jeddah", "Jeddah", "port", "SA", 21.48, 39.17, "jeddah|jiddah|जेद्दा", { seaNode: "jeddah_appr" }],
  ["dammam", "Dammam", "port", "SA", 26.5, 50.2, "dammam", { seaNode: "persian_w" }],
  // ---- East & Southeast Asia ports
  ["shenzhen", "Shenzhen (Yantian)", "port", "CN", 22.56, 114.28, "shenzhen|yantian|shekou|शेन्ज़ेन|शेनझेन|શેનઝેન|ஷென்ஜென்", { seaNode: "hk_appr" }],
  ["guangzhou", "Guangzhou (Nansha)", "port", "CN", 22.74, 113.61, "guangzhou|nansha|canton|ग्वांगझू|குவாங்சோ", { seaNode: "hk_appr" }],
  ["hongkong", "Hong Kong", "port", "HK", 22.3, 114.15, "hong kong|hongkong|हांगकांग|હોંગકોંગ|ஹாங்காங்", { seaNode: "hk_appr" }],
  ["shanghai", "Shanghai", "port", "CN", 30.63, 122.06, "shanghai|yangshan|शंघाई|શાંઘાઈ|ஷாங்காய்", { seaNode: "ecs" }],
  ["ningbo", "Ningbo-Zhoushan", "port", "CN", 29.87, 121.85, "ningbo|zhoushan|निंगबो", { seaNode: "ecs" }],
  ["qingdao", "Qingdao", "port", "CN", 36.07, 120.32, "qingdao|tsingtao", { seaNode: "yellow_sea" }],
  ["tianjin", "Tianjin", "port", "CN", 38.99, 117.74, "tianjin|xingang|tianjin xingang", { seaNode: "bohai" }],
  ["xiamen", "Xiamen", "port", "CN", 24.45, 118.07, "xiamen", { seaNode: "taiwan_st" }],
  ["busan", "Busan", "port", "KR", 35.1, 129.04, "busan|pusan|बुसान", { seaNode: "korea_st" }],
  ["singapore", "Singapore", "port", "SG", 1.26, 103.82, "singapore|psa singapore|सिंगापुर|સિંગાપુર|சிங்கப்பூர்", { seaNode: "sing_strait" }],
  ["port_klang", "Port Klang", "port", "MY", 3.0, 101.37, "port klang|klang|westports", { seaNode: "malacca" }],
  ["tanjung_pelepas", "Tanjung Pelepas", "port", "MY", 1.36, 103.55, "tanjung pelepas|ptp", { seaNode: "sing_strait" }],
  ["laem_chabang", "Laem Chabang", "port", "TH", 13.08, 100.89, "laem chabang|bangkok port|bangkok", { seaNode: "gulf_thai" }],
  ["hcmc", "Ho Chi Minh (Cat Lai / Cai Mep)", "port", "VN", 10.5, 107.03, "ho chi minh|cai mep|cat lai|saigon|vung tau", { seaNode: "vungtau" }],
  ["haiphong", "Haiphong", "port", "VN", 20.85, 106.75, "haiphong|hai phong", { seaNode: "haiphong_appr" }],
  ["jakarta", "Jakarta (Tanjung Priok)", "port", "ID", -6.1, 106.88, "jakarta|tanjung priok", { seaNode: "java_sea" }],
];
