// BETALING.
//
// Stripe nås med almindelig fetch frem for deres SDK. Ikke af princip: pakken kunne ikke hentes
// i det miljø koden blev skrevet i, og en usikker webhook-verifikation jeg ikke kan afprøve er
// værre end en jeg selv har skrevet og testet. Kaldene er tre, og de er formularkodede.

export const PLANER = {
  kontor: {
    navn: "Kontor",
    beskrivelse: "Til ét mæglerkontor",
    oere: 299500,                 // 2.995 kr
    inkluderede: 10,
    punkter: ["10 boliger om måneden", "Ubegrænset basis-video", "Alle formater"],
  },
  kaede: {
    navn: "Kæde",
    beskrivelse: "Til flere kontorer",
    oere: 1150000,                // 11.500 kr
    inkluderede: 50,
    punkter: ["50 boliger om måneden", "Flere brugere per konto", "Prioriteret support"],
  },
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
      recurring: { interval: "month" },
      product_data: { name: `Rundvis ${plan.navn}` },
    },
  };
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
