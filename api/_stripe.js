// BETALING.
//
// Stripe nås med almindelig fetch frem for deres SDK. Ikke af princip: pakken kunne ikke hentes
// i det miljø koden blev skrevet i, og en usikker webhook-verifikation jeg ikke kan afprøve er
// værre end en jeg selv har skrevet og testet. Kaldene er tre, og de er formularkodede.

// NIVEAUERNE. Målt i boliger, ikke i brugere: en bruger koster os ingenting, en bolig koster os
// fjorten Luma-klip. Derfor er alle betalte niveauer fri adgang for hele kontoret, og derfor er
// trappen nedad i pris per bolig flad med vilje — 595, 499, 450, 433. Mængderabat i software er
// gratis at give; her går den direkte fra bundlinjen.
//
// "slags" afgør hvordan niveauet sælges, og de tre er ikke ens:
//   abonnement  Stripe Checkout i subscription-tilstand. Virker i dag.
//   engang      ét køb, én bolig. Kræver at kontoen kan holde løse boliger, og den søjle
//               findes ikke i db/001_konti.sql endnu — derfor sælges den ikke endnu.
//   aftale      prisen forhandles. Ingen knap kan gøre det, så den sender en mail.
export const PLANER = {
  enkelt: {
    navn: "Enkelt",
    beskrivelse: "Én bolig, ingen binding",
    oere: 59500,                  // 595 kr
    inkluderede: 1,
    slags: "engang",
  },
  maegler: {
    navn: "Mægler",
    beskrivelse: "Til den enkelte mægler",
    oere: 249500,                 // 2.495 kr — 499 kr per bolig
    inkluderede: 5,
    slags: "abonnement",
  },
  kontor: {
    navn: "Kontor",
    beskrivelse: "Til ét mæglerkontor",
    oere: 899500,                 // 8.995 kr — 450 kr per bolig
    inkluderede: 20,
    slags: "abonnement",
  },
  kaede: {
    navn: "Kæde",
    beskrivelse: "Til flere kontorer",
    oere: 1300000,                // fra 13.000 kr — ~433 kr per bolig
    inkluderede: 30,
    slags: "aftale",
  },
};

// HVAD DER FØLGER MED. Én liste, ens på alle fire kort, hvor det man ikke får står streget
// over frem for bare at mangle. Fire forskellige lister, hver med sine egne salgsord, lader
// som om niveauerne er forskellige produkter — og en kunde der ikke kan se hvad han går glip
// af, kan heller ikke se hvad han får.
//
// Intet står her som ikke er til at holde. "Prioritet i køen" er væk: der er ingen kø at have
// prioritet i. De fire nederste er heller ikke bygget endnu — se noten i README før siden
// vises frem for nogen der kan betale.
export const FORDELE = [
  // Tre linjer, ikke seks. Lange fordelslister læser som nogen der prøver at fylde kortet ud,
  // og de linjer der røg var enten sande for alle i forvejen (formater, egen musik) eller
  // umulige at holde (support døgnet rundt). Det der står tilbage, er det der faktisk
  // adskiller et abonnement fra et enkeltkøb.
  { tekst: "Eget logo og farver", har: ["maegler", "kontor", "kaede"] },
  { tekst: "Alle på kontoret kan logge ind", har: ["maegler", "kontor", "kaede"] },
  { tekst: "Ubrugte boliger ruller en måned videre", har: ["maegler", "kontor", "kaede"] },
];

// Ekstra ud over det inkluderede. Begge er dyrere end stykprisen på ens eget niveau, så der
// altid er en grund til at rykke op frem for at købe løst.
export const EKSTRA = {
  boligOere: 49500,               // 495 kr — billigere end Enkelt, dyrere end Mægler-stykprisen
  billedeOere: 3500,              // 35 kr per billede ud over loftet. Kostprisen er cirka 10 kr.
};


const API = "https://api.stripe.com/v1";
const noegle = () => process.env.STRIPE_SECRET_KEY || "";

export function stripeErSat() {
  return Boolean(noegle());
}

// Stripe tager formularkodede parametre, også de indlejrede. Den her flader et objekt ud til
// de firkantede parenteser deres API forventer: {a:{b:1}} bliver "a[b]=1".
function flad(obj, praefiks = "", ud = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const noegleNavn = praefiks ? `${praefiks}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) flad(v, noegleNavn, ud);
    else if (Array.isArray(v)) v.forEach((e, i) => {
      if (typeof e === "object") flad(e, `${noegleNavn}[${i}]`, ud);
      else ud.append(`${noegleNavn}[${i}]`, String(e));
    });
    else ud.append(noegleNavn, String(v));
  }
  return ud;
}

export async function stripeKald(sti, params, metode = "POST") {
  if (!noegle()) throw new Error("Stripe er ikke sat op.");
  const r = await fetch(`${API}/${sti}`, {
    method: metode,
    headers: {
      Authorization: `Bearer ${noegle()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: metode === "POST" ? flad(params || {}).toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Stripe svarede ${r.status}.`);
  return j;
}

// Prisen sendes med i kaldet frem for at pege på et Price-objekt, så der ikke skal oprettes
// noget i Stripes kontrolpanel før det virker — nøglen er nok. Er STRIPE_PRICE_<PLAN> sat,
// bruges den i stedet; det er vejen videre når priserne skal kunne ændres uden en commit.
export function prisFor(planNoegle) {
  const plan = PLANER[planNoegle];
  if (!plan) return null;
  const fast = process.env[`STRIPE_PRICE_${planNoegle.toUpperCase()}`];
  if (fast) return { price: fast, quantity: 1 };
  return {
    quantity: 1,
    price_data: {
      currency: "dkk",
      unit_amount: plan.oere,
      // Et engangskøb må ikke have recurring med. Sender man den til Stripe i
      // payment-tilstand, afviser de kaldet.
      ...(plan.slags === "abonnement" ? { recurring: { interval: "month" } } : {}),
      product_data: { name: `Rundvis ${plan.navn}` },
    },
  };
}

// Hvad der kan købes med et kort lige nu. Enkelt og Kæde står på siden med deres pris, men
// kan ikke betales her: den ene mangler en søjle i databasen, den anden mangler en samtale.
export function kanKoebes(planNoegle) {
  const plan = PLANER[planNoegle];
  return Boolean(plan && plan.slags === "abonnement");
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK-SIGNATUREN. Det sikkerhedskritiske sted i hele filen.
//
// Uden den kan enhver sende os "abonnementet er aktivt" og få gratis adgang for evigt. Stripes
// ordning: headeren er "t=<tid>,v1=<signatur>", og signaturen er HMAC-SHA256 over "<tid>.<krop>"
// med webhook-hemmeligheden.
//
// To ting der er lette at gøre forkert, og som begge er afprøvet:
//   kroppen skal være den RÅ tekst, ikke et genserialiseret JSON-objekt
//   tiden skal tjekkes, ellers kan en gammel, fanget hændelse sendes igen for evigt
const TOLERANCE_SEK = 300;

export async function verificerWebhook(raaKrop, signaturHeader, hemmelighed) {
  if (!raaKrop || !signaturHeader || !hemmelighed) return null;
  const dele = String(signaturHeader).split(",").map((d) => d.split("="));
  const t = (dele.find((d) => d[0] === "t") || [])[1];
  const v1 = dele.filter((d) => d[0] === "v1").map((d) => d[1]);
  if (!t || !v1.length) return null;

  const alder = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(alder) || alder > TOLERANCE_SEK) return null;

  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(hemmelighed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", k, enc.encode(`${t}.${raaKrop}`));
  const forventet = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Konstant tid, så signaturen ikke kan findes ét tegn ad gangen.
  const passer = v1.some((sig) => {
    if (sig.length !== forventet.length) return false;
    let diff = 0;
    for (let i = 0; i < forventet.length; i++) diff |= forventet.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  });
  if (!passer) return null;

  try { return JSON.parse(raaKrop); } catch (e) { return null; }
}

// Vercel har allerede læst og fortolket kroppen for os, og et genserialiseret objekt har ikke
// samme bytes som det Stripe signerede. Her læses strømmen rå i stedet.
export async function raaKrop(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const stykker = [];
  for await (const s of req) stykker.push(typeof s === "string" ? Buffer.from(s) : s);
  return Buffer.concat(stykker).toString("utf8");
}
