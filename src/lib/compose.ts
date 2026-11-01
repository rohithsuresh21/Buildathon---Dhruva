import type { Verdict } from "./types";

export type Lang = "en" | "hi" | "gu" | "ta";
export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: "en", label: "English", native: "English" },
  { id: "hi", label: "Hindi", native: "हिन्दी" },
  { id: "gu", label: "Gujarati", native: "ગુજરાતી" },
  { id: "ta", label: "Tamil", native: "தமிழ்" },
];

export type ActionKind = "proceed" | "watch" | "reroute" | "hold";

export interface ComposeInput {
  cargo: string;
  from: string;
  to: string;
  verdict: Verdict;
  where: string;
  asOf: string;
  evidence: string;
  action: ActionKind;
  via?: string;
  extraDays?: number;
}

const VP: Record<Lang, Record<Verdict, string>> = {
  en: { green: "no disruption signal", amber: "a developing risk of delay", red: "a high risk of delay", abstain: "not enough fresh data to judge" },
  hi: { green: "कोई व्यवधान संकेत नहीं", amber: "देरी का बढ़ता जोखिम", red: "देरी का उच्च जोखिम", abstain: "आकलन के लिए पर्याप्त ताज़ा डेटा नहीं" },
  gu: { green: "કોઈ અવરોધનો સંકેત નથી", amber: "વિલંબનું વધતું જોખમ", red: "વિલંબનું ઊંચું જોખમ", abstain: "આકલન માટે પૂરતો તાજો ડેટા નથી" },
  ta: { green: "எந்த இடையூறு சமிக்ஞையும் இல்லை", amber: "தாமதத்திற்கான அபாயம் அதிகரித்து வருகிறது", red: "தாமதத்திற்கான அதிக அபாயம்", abstain: "மதிப்பிட போதுமான புதிய தரவு இல்லை" },
};

const ACT: Record<Lang, Record<ActionKind, string>> = {
  en: {
    proceed: "proceed as planned",
    watch: "keep the booking and we will re-check in 24 hours",
    reroute: "move to the alternative routing via {via}, about {days} extra days",
    hold: "hold dispatch until the next update",
  },
  hi: {
    proceed: "योजना के अनुसार आगे बढ़ें",
    watch: "बुकिंग रखें, हम 24 घंटे में दोबारा जाँच करेंगे",
    reroute: "{via} के रास्ते वैकल्पिक मार्ग पर जाएँ, लगभग {days} दिन अधिक",
    hold: "अगले अपडेट तक शिपमेंट रोकें",
  },
  gu: {
    proceed: "યોજના મુજબ આગળ વધો",
    watch: "બુકિંગ ચાલુ રાખો, અમે 24 કલાકમાં ફરી તપાસ કરીશું",
    reroute: "{via} મારફતે વૈકલ્પિક માર્ગ અપનાવો, લગભગ {days} દિવસ વધુ",
    hold: "આગામી અપડેટ સુધી શિપમેન્ટ રોકી રાખો",
  },
  ta: {
    proceed: "திட்டமிட்டபடி தொடரவும்",
    watch: "முன்பதிவை வைத்திருங்கள், 24 மணி நேரத்தில் மீண்டும் சரிபார்ப்போம்",
    reroute: "{via} வழியாக மாற்று வழித்தடத்திற்கு மாறவும், சுமார் {days} கூடுதல் நாட்கள்",
    hold: "அடுத்த புதுப்பிப்பு வரை அனுப்புவதை நிறுத்தி வைக்கவும்",
  },
};

const BODY: Record<Lang, string> = {
  en: "Hello,\n\nRegarding {cargo} from {from} to {to}: our lane monitoring shows {vp} on {where} as of {asOf} UTC.\nEvidence: {evidence}\n\nSuggested action: {action}.\n\nPlease reply with the current ETD, the booking or container number, and whether you can accommodate this.\n\nThank you.",
  hi: "नमस्ते,\n\n{from} से {to} तक {cargo} के संबंध में: हमारी निगरानी के अनुसार {where} पर {vp} है ({asOf} UTC तक)।\nआधार: {evidence}\n\nसुझाई गई कार्रवाई: {action}।\n\nकृपया वर्तमान ETD, बुकिंग या कंटेनर नंबर बताएँ, और यह भी कि क्या आप इसे संभाल सकते हैं।\n\nधन्यवाद।",
  gu: "નમસ્તે,\n\n{from} થી {to} સુધીના {cargo} અંગે: અમારી દેખરેખ મુજબ {where} પર {vp} છે ({asOf} UTC સુધી).\nઆધાર: {evidence}\n\nસૂચવેલ કાર્યવાહી: {action}.\n\nકૃપા કરીને વર્તમાન ETD, બુકિંગ અથવા કન્ટેનર નંબર જણાવો, અને તમે આ સંભાળી શકશો કે કેમ તે પણ જણાવો.\n\nઆભાર.",
  ta: "வணக்கம்,\n\n{from} இலிருந்து {to} வரையிலான {cargo} தொடர்பாக: எங்கள் கண்காணிப்பின்படி {where} இல் {vp} ({asOf} UTC நிலவரப்படி).\nஆதாரம்: {evidence}\n\nபரிந்துரைக்கும் நடவடிக்கை: {action}.\n\nதற்போதைய ETD, முன்பதிவு அல்லது கொள்கலன் எண்ணைத் தெரிவிக்கவும்; இதை உங்களால் கையாள முடியுமா என்பதையும் கூறவும்.\n\nநன்றி.",
};

function fill(t: string, v: Record<string, string>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
}

export function compose(lang: Lang, i: ComposeInput): string {
  const action = fill(ACT[lang][i.action], { via: i.via ?? "", days: String(Math.round(i.extraDays ?? 0)) });
  return fill(BODY[lang], {
    cargo: i.cargo,
    from: i.from,
    to: i.to,
    vp: VP[lang][i.verdict],
    where: i.where,
    asOf: i.asOf,
    evidence: i.evidence,
    action,
  });
}

export function actionFor(v: Verdict, hasReroute: boolean): ActionKind {
  if (v === "red") return hasReroute ? "reroute" : "hold";
  if (v === "amber") return "watch";
  if (v === "abstain") return "watch";
  return "proceed";
}
