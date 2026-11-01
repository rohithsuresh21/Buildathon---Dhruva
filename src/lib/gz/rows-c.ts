import type { Row } from "../gazetteer";

export const ROWS_C: Row[] = [
  // ---- Europe / Africa / Americas ports
  ["rotterdam", "Rotterdam", "port", "NL", 51.95, 4.14, "rotterdam|रॉटरडैम|રોટરડેમ|ரோட்டர்டாம்", { seaNode: "north_sea_s" }],
  ["antwerp", "Antwerp", "port", "BE", 51.27, 4.3, "antwerp|antwerpen", { seaNode: "north_sea_s" }],
  ["hamburg", "Hamburg", "port", "DE", 53.54, 9.97, "hamburg|हैम्बर्ग|ஹாம்பர்க்", { seaNode: "elbe_appr" }],
  ["felixstowe", "Felixstowe", "port", "GB", 51.95, 1.3, "felixstowe|london gateway|uk port", { seaNode: "north_sea_s" }],
  ["genoa", "Genoa", "port", "IT", 44.41, 8.91, "genoa|genova", { seaNode: "ligurian" }],
  ["piraeus", "Piraeus", "port", "GR", 37.94, 23.63, "piraeus|athens port", { seaNode: "piraeus_appr" }],
  ["valencia", "Valencia", "port", "ES", 39.45, -0.32, "valencia", { seaNode: "med_w" }],
  ["algeciras", "Algeciras", "port", "ES", 36.13, -5.43, "algeciras", { seaNode: "gibraltar" }],
  ["alexandria", "Alexandria", "port", "EG", 31.2, 29.88, "alexandria|port said|damietta", { seaNode: "med_e" }],
  ["durban", "Durban", "port", "ZA", -29.87, 31.03, "durban", { seaNode: "durban_appr" }],
  ["mombasa", "Mombasa", "port", "KE", -4.07, 39.67, "mombasa", { seaNode: "mombasa_appr" }],
  ["lagos", "Lagos (Apapa / Tin Can)", "port", "NG", 6.44, 3.36, "lagos|apapa|tin can", { seaNode: "lagos_appr" }],
  ["newyork", "New York / New Jersey", "port", "US", 40.67, -74.15, "new york|newark|nynj|new jersey", { seaNode: "ny_appr" }],
  ["savannah", "Savannah", "port", "US", 32.08, -81.09, "savannah", { seaNode: "savannah_appr" }],
  ["houston", "Houston", "port", "US", 29.73, -95.27, "houston", { seaNode: "houston_appr" }],
  ["losangeles", "Los Angeles / Long Beach", "port", "US", 33.73, -118.26, "los angeles|long beach|la port", { seaNode: "la_appr" }],
];
