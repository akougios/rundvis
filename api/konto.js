// Alt profilmenuen skal vise, i ét kald: hvem, hvilken plan, hvor meget er brugt, og hvilke
// planer man kan vælge. Ét kald frem for fire, fordi menuen åbnes og skal være udfyldt med det
// samme — ikke fylde sig selv ud mens man kigger på den.

import { brugerFraToken, kontoFor, supabaseErSat, opgraderingsRet } from "./_konto.js";
import { PLANER, FORDELE, stripeErSat } from "./_stripe.js";

const sb = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const service = () => process.env.SUPABASE_SERVICE_KEY || "";

// Boliger brugt i den nuværende periode. Tælles på DISTINKTE bolig-id'er, ikke på klip: en
// bolig med atten rum er én bolig, og det er boliger kunden betaler for.
async function brugtIPerioden(kontoId, fra) {
  if (!sb() || !service()) return 0;
  try {
    const r = await fetch(
      `${sb()}/rest/v1/forbrug?konto_id=eq.${kontoId}&tidspunkt=gte.${encodeURIComponent(fra)}&select=bolig_id`,
      { headers: { apikey: service(), Authorization: `Bearer ${service()}` } },
    );
    if (!r.ok) return 0;
    const rows = await r.json();
    return new Set((rows || []).map((x) => x.bolig_id).filter(Boolean)).size;
  } catch (e) {
    return 0;
  }
}

// Versionen af databehandleraftalen. Staar ogsaa i public/index.html og i
// public/databehandler.html; aendres aftalen, skal alle tre foelges ad, og saa skal kunderne
// acceptere den nye.
const AFTALE_VERSION = "2026-11-02";

// Skriver accepten paa kontoen. Kaldes af browseren lige efter en oprettelse er lykkedes -
// baade efter mail-oprettelse og efter Google, som ellers ikke kan baere metadata med gennem
// OAuth-omdirigeringen.
//
// Overskriver ikke en eksisterende accept af SAMME version: man accepterer én gang, og
// tidspunktet skal vaere det foerste, ikke det seneste login.
async function gemAftale(kontoId, email) {
  if (!supabaseErSat() || !kontoId) return false;
  try {
    const r = await fetch(
      `${url()}/rest/v1/konto?id=eq.${kontoId}&aftale_version=is.null`,
      {
        method: "PATCH",
        headers: {
          apikey: service(),
          Authorization: `Bearer ${service()}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          aftale_version: AFTALE_VERSION,
          aftale_accepteret: new Date().toISOString(),
          aftale_af: (email || "").slice(0, 160),
        }),
      },
    );
    return r.ok;
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  // En plan der forhandles sender ikke et tal med. Kaede stod med "fra 13.000 kr", og det var
  // et anker vi ikke oenskede: en kaede med ti kontorer laver to hundrede boliger om maaneden,
  // ikke tredive, saa tallet fortalte enten en forkert pris eller at vi ikke havde forstaaet
  // kundens stoerrelse. Det er ikke nok at skjule det i frontenden - saa staar det stadig i
  // svaret fra API'et og kan laeses af enhver der kigger efter.
  const planer = Object.entries(PLANER).map(([noegle, p]) => ({
    noegle, navn: p.navn, beskrivelse: p.beskrivelse,
    kr: p.slags === "aftale" ? null : Math.round(p.oere / 100),
    inkluderede: p.slags === "aftale" ? null : p.inkluderede,
    // Hele listen, hver linje med om DEN her plan har den. Frontenden streger resten over
    // frem for at udelade dem, så kortene kan læses ved siden af hinanden.
    fordele: FORDELE.map((f) => ({ tekst: f.tekst, med: f.har.includes(noegle) })),
    slags: p.slags,
    // Stykprisen regnes her frem for i frontenden, så de to ikke kan komme til at vise
    // forskellige tal for samme plan.
    perBolig: p.slags === "aftale" ? null : Math.round(p.oere / 100 / Math.max(1, p.inkluderede)),
  }));

  // Menuen skal kunne vise planerne selv når intet er sat op endnu. "Her er hvad det koster"
  // er en del af produktet, ikke noget der først findes når Stripe er koblet på.
  if (!supabaseErSat()) {
    res.status(200).json({ loggetInd: false, planer, betalingAktivt: stripeErSat() });
    return;
  }

  const bruger = await brugerFraToken(req);
  if (!bruger) { res.status(200).json({ loggetInd: false, planer, betalingAktivt: stripeErSat() }); return; }

  const konto = await kontoFor(bruger.id);
  if (!konto) { res.status(200).json({ loggetInd: true, email: bruger.email, planer, betalingAktivt: stripeErSat() }); return; }

  // Accepten af databehandleraftalen skrives her frem for i et endpoint for sig. Vercels
  // gratisplan tillader tolv funktioner, og der er elleve - den sidste plads er for dyr at
  // bruge paa ét PATCH.
  if (req.method === "POST" && req.body && req.body.handling === "aftale") {
    const ok = await gemAftale(konto.id, bruger.email);
    res.status(200).json({ ok, version: AFTALE_VERSION });
    return;
  }

  // Perioden er Stripes, når den findes. Ellers denne kalendermåned, så tallet er rigtigt
  // også før der er tegnet noget.
  const nu = new Date();
  const fra = konto.periode_slut
    ? new Date(new Date(konto.periode_slut).getTime() - 31 * 864e5).toISOString()
    : new Date(nu.getFullYear(), nu.getMonth(), 1).toISOString();

  const ret = await opgraderingsRet(konto, null);

  res.status(200).json({
    loggetInd: true,
    email: bruger.email,
    betalingAktivt: stripeErSat(),
    planer,
    konto: {
      navn: konto.navn,
      status: konto.abonnement_status,
      inkluderede: konto.inkluderede_boliger,
      brugt: await brugtIPerioden(konto.id, fra),
      periodeSlut: konto.periode_slut || null,
      harKunde: Boolean(konto.stripe_kunde_id),
      // Saa browseren kan se om der mangler en accept - fx hvis aftalen er blevet opdateret
      // siden kunden sagde ja.
      aftaleVersion: konto.aftale_version || null,
      aftaleMangler: (konto.aftale_version || null) !== AFTALE_VERSION,
      // MAA DEN HER KONTO OPGRADERE, LIGE NU?
      //
      // Samme funktion som porten selv bruger, saa browseren ikke skal gaette reglerne - og
      // ikke KAN gaette dem: hverken fri_adgang eller gratis_boliger staar i det den faar.
      // Uden det her kunne knappen kun afvise paa status === "aktiv", og saa ville ejerne og
      // testerne blive stoppet af deres egen app.
      //
      // Svaret er altid serverens. Det her sparer bare maegleren for at uploade tolv billeder
      // og vente, foer han faar at vide at han ikke maatte.
      maaOpgradere: ret.maa,
    },
  });
}
