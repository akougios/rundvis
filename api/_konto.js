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

// Den adresse en afvist bruger skal skrive til. Staar ogsaa i public/index.html som KONTAKT_MAIL;
// de to skal foelges ad, og det er derfor den staar som en konstant og ikke inde i en saetning.
const KONTAKT_MAIL = process.env.KONTAKT_MAIL || "akougios@gmail.com";

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

// HVILKE BOLIGER HAR KONTOEN ALLEREDE BRUGT PENGE PÅ.
//
// Distinkte boliger, ikke klip. Det er den enhed kunden betaler per i hele resten af modellen,
// og det er også den rigtige enhed for en kvote: en tester der har fået fem boliger skal kunne
// køre alle elleve billeder af den femte igennem uden at blive afbrudt midt i.
export async function brugteBoliger(kontoId) {
  if (!supabaseErSat() || !kontoId) return new Set();
  try {
    const r = await fetch(
      `${url()}/rest/v1/forbrug?konto_id=eq.${kontoId}&bolig_id=not.is.null&select=bolig_id`,
      { headers: { apikey: service(), Authorization: `Bearer ${service()}` } },
    );
    if (!r.ok) return new Set();
    const rows = await r.json();
    return new Set((Array.isArray(rows) ? rows : []).map((x) => x.bolig_id).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

// SØRG FOR AT BOLIGEN FINDES, før der skrives forbrug på den.
//
// forbrug.bolig_id peger på bolig(id), men ingen har nogensinde indsat en række i bolig -
// browseren laver bare en UUID og sender den med. Fremmednøglen afviser derfor hvert eneste
// forbrugs-insert, og skrivForbrug sluger fejlen i stilhed. Resultatet er en tom forbrugstabel:
// ingen fakturering, ingen omkostningsoversigt, og ingen kvote der kan tælle på noget.
//
// Fejler aldrig opad, af samme grund som skrivForbrug: bogføring er vores problem, ikke kundens.
export async function sikrBolig(kontoId, boligId, adresse) {
  if (!supabaseErSat() || !kontoId || !boligId) return;
  try {
    await fetch(`${url()}/rest/v1/bolig`, {
      method: "POST",
      headers: {
        apikey: service(),
        Authorization: `Bearer ${service()}`,
        "Content-Type": "application/json",
        // Findes den allerede, er der ingenting at gøre - og det er det normale tilfælde,
        // for alle klip i samme bolig sender den samme id.
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ id: boligId, konto_id: kontoId, adresse: adresse || null }),
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

  if (kraevAbonnement) {
    // RÆKKEFØLGEN ER PORTENS REGELSÆT, og den er med vilje sådan her:
    //
    //   1. fri_adgang      ejerne. Ingen grænse, intet opslag.
    //   2. aktivt abonnement   kunden har betalt. Som før.
    //   3. gratis_boliger  testerne. Tælles mod distinkte boliger i forbrug.
    //   4. ellers          lukket.
    //
    // Punkt fire er nyt og er hele pointen. Før stod der kun punkt to, og den gjaldt kun når
    // der FANDTES en Stripe-nøgle - så uden Stripe kunne enhver der var logget ind opgradere
    // frit. Hvert klip koster rigtige penge hos Luma, så der var ingen bund i det.
    if (!konto.fri_adgang) {
      const harAbonnement = stripeOppe && konto.abonnement_status === "aktiv";
      if (!harAbonnement) {
        const gratis = Number(konto.gratis_boliger) || 0;
        const boligId = (req.body && req.body.boligId) || null;
        const brugt = await brugteBoliger(konto.id);
        // En bolig der allerede er betalt for tæller ikke igen. Ellers blev en tester afbrudt
        // midt i sin femte bolig, med halvdelen af billederne opgraderet.
        const nyBolig = Boolean(boligId) && !brugt.has(boligId);
        const efter = brugt.size + (nyBolig ? 1 : 0);
        if (efter > gratis) {
          res.status(402).json({
            // Adressen SKAL staa i selve beskeden. Der stod "skriv til os" uden at sige hvem, og
            // den besked moeder man praecis naar man har brugt sin sidste gratis bolig - altsaa
            // paa det daarligste tidspunkt at sende nogen ud at lede.
            error: gratis > 0
              ? `Du har brugt dine ${gratis} gratis boliger. Skriv til ${KONTAKT_MAIL} for at fortsætte.`
              : `Opgradering kræver et abonnement. Den gratis video kan du lave som du vil — skriv til ${KONTAKT_MAIL} hvis du vil høre mere.`,
            needsSubscription: true,
            status: konto.abonnement_status,
            brugteBoliger: brugt.size,
            gratisBoliger: gratis,
          });
          return null;
        }
      }
    }
  }

  // Porten er passeret. Boligen skal findes i databasen før forbruget kan bogføres på den,
  // uanset hvilken af de fire veje der førte hertil — ellers afviser fremmednøglen insertet.
  const sagId = (req.body && req.body.boligId) || null;
  if (sagId) await sikrBolig(konto.id, sagId, (req.body && req.body.adresse) || null);

  // Returnerer hvem det er, så endpointet kan bogføre forbruget uden at slå det op igen.
  return { bruger, konto };
}
