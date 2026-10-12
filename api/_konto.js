// HVEM ER DET, OG MÅ DE BRUGE PENGE?
//
// Alt herinde taler med Supabase over almindelig fetch frem for deres SDK. Projektet har én
// afhængighed i dag, og to REST-kald er ikke en pakke værd.
//
// To nøgler, og forskellen er hele sikkerheden:
//   SUPABASE_ANON_KEY    offentlig, ligger i browseren, begrænset af row level security
//   SUPABASE_SERVICE_KEY kun på serveren, går UDEN OM row level security
// Service-nøglen må aldrig nå browseren. Den er grunden til at abonnementsstatus kan sættes af
// Stripe-webhooken og ikke af den der ejer kontoen.

const url = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const service = () => process.env.SUPABASE_SERVICE_KEY || "";

export function supabaseErSat() {
  return Boolean(url() && service());
}

// Hvem sidder bag dette kald? Spørger Supabase frem for at tjekke signaturen selv.
// Et ekstra netværkshop på ~50 ms på et endpoint der tager minutter, mod at vi ikke selv skal
// have ret i hvordan en JWT valideres. Det bytte er let.
export async function brugerFraToken(req) {
  const raw = req.headers.authorization || req.headers.Authorization || "";
  const token = typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice(7) : "";
  if (!token || !url()) return null;
  try {
    const r = await fetch(`${url()}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY || service() },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id, email: u.email || "" } : null;
  } catch (e) {
    return null;
  }
}

// Kontoen brugeren hører til, med abonnementet. Service-nøglen bruges her, så svaret ikke
// afhænger af at vi har fået row level security helt rigtigt.
export async function kontoFor(brugerId) {
  if (!supabaseErSat() || !brugerId) return null;
  try {
    const r = await fetch(
      `${url()}/rest/v1/medlemskab?bruger_id=eq.${brugerId}&select=konto_id,rolle,konto(*)&limit=1`,
      { headers: { apikey: service(), Authorization: `Bearer ${service()}` } },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && row.konto ? row.konto : null;
  } catch (e) {
    return null;
  }
}

// Én linje per klip, også når det fejlede. Et fejlet klip bliver ofte faktureret alligevel, og
// en omkostning der ikke står nogen steder, findes stadig på regningen.
//
// Fejler aldrig opad: at kunne ikke bogføre et forbrug er et problem for os, ikke en grund til
// at nægte kunden den video de har betalt for.
export async function skrivForbrug(linje) {
  if (!supabaseErSat() || !linje || !linje.konto_id) return;
  try {
    await fetch(`${url()}/rest/v1/forbrug`, {
      method: "POST",
      headers: {
        apikey: service(),
        Authorization: `Bearer ${service()}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(linje),
    });
  } catch (e) {
    /* bevidst tavs */
  }
}

// PORTEN foran alt der koster penge.
//
// Rækkefølgen er med vilje: er Supabase slet ikke sat op, falder vi tilbage til den delte
// adgangskode, så en halvfærdig opsætning ikke vælter en kørende deployment. Er Supabase sat
// op, er login et krav — og abonnementet oveni, når kraevAbonnement er slået til.
export async function maaBruge(req, res, { kraevAbonnement = true } = {}) {
  if (!supabaseErSat()) {
    const { allowedToSpend } = await import("./_access.js");
    // Samme form som nedenfor, så kaldstedet kun har ét svar at forholde sig til.
    return (await allowedToSpend(req, res)) ? { bruger: null, konto: null } : null;
  }

  const bruger = await brugerFraToken(req);
  if (!bruger) {
    res.status(401).json({ error: "Du skal være logget ind.", needsLogin: true });
    return null;
  }

  const konto = await kontoFor(bruger.id);
  if (!konto) {
    res.status(403).json({ error: "Din bruger hører ikke til en konto. Kontakt os." });
    return null;
  }

  // Abonnementet kræves kun når der FINDES en måde at tegne et på. Uden en Stripe-nøgle ville
  // kravet låse alle ude af et produkt ingen kan betale for — og det slår sig selv til den dag
  // nøglen sættes, i stedet for at afhænge af at nogen husker et flag.
  const stripeOppe = Boolean(process.env.STRIPE_SECRET_KEY);
  if (kraevAbonnement && stripeOppe && konto.abonnement_status !== "aktiv") {
    res.status(402).json({
      error: "Opgraderingen kræver et aktivt abonnement.",
      needsSubscription: true,
      status: konto.abonnement_status,
    });
    return null;
  }

  // Returnerer hvem det er, så endpointet kan bogføre forbruget uden at slå det op igen.
  return { bruger, konto };
}
