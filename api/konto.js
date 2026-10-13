// Alt profilmenuen skal vise, i ét kald: hvem, hvilken plan, hvor meget er brugt, og hvilke
// planer man kan vælge. Ét kald frem for fire, fordi menuen åbnes og skal være udfyldt med det
// samme — ikke fylde sig selv ud mens man kigger på den.

import { brugerFraToken, kontoFor, supabaseErSat } from "./_konto.js";
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

export default async function handler(req, res) {
  const planer = Object.entries(PLANER).map(([noegle, p]) => ({
    noegle, navn: p.navn, beskrivelse: p.beskrivelse,
    kr: Math.round(p.oere / 100), inkluderede: p.inkluderede,
    // Hele listen, hver linje med om DEN her plan har den. Frontenden streger resten over
    // frem for at udelade dem, så kortene kan læses ved siden af hinanden.
    fordele: FORDELE.map((f) => ({ tekst: f.tekst, med: f.har.includes(noegle) })),
    slags: p.slags,
    // Stykprisen regnes her frem for i frontenden, så de to ikke kan komme til at vise
    // forskellige tal for samme plan.
    perBolig: Math.round(p.oere / 100 / Math.max(1, p.inkluderede)),
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

  // Perioden er Stripes, når den findes. Ellers denne kalendermåned, så tallet er rigtigt
  // også før der er tegnet noget.
  const nu = new Date();
  const fra = konto.periode_slut
    ? new Date(new Date(konto.periode_slut).getTime() - 31 * 864e5).toISOString()
    : new Date(nu.getFullYear(), nu.getMonth(), 1).toISOString();

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
    },
  });
}
