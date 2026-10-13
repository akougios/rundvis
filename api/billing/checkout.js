// Starter en Stripe Checkout. Den side håndterer selv kort, Apple Pay, Google Pay og MobilePay
// hvor det er slået til i Stripes kontrolpanel — derfor er det ikke fire integrationer her,
// men én.

import { maaBruge } from "../_konto.js";
import { PLANER, prisFor, stripeKald, stripeErSat, kanKoebes } from "../_stripe.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Kun POST er tilladt." }); return; }
  if (!stripeErSat()) { res.status(503).json({ error: "Betaling er ikke sat op endnu." }); return; }

  // Login kræves, abonnement gør ikke: det er netop dét man er her for at tegne.
  const adgang = await maaBruge(req, res, { kraevAbonnement: false });
  if (!adgang) return;
  const { bruger, konto } = adgang;
  if (!konto) { res.status(403).json({ error: "Ingen konto fundet." }); return; }

  const plan = (req.body && req.body.plan) || "";
  if (!PLANER[plan]) { res.status(400).json({ error: "Ukendt plan." }); return; }
  // Enkelt og Kæde står på siden, men kan ikke betales her endnu. Frontenden viser dem uden
  // købsknap; dette er spærringen for den der kalder api'et direkte.
  if (!kanKoebes(plan)) {
    res.status(409).json({
      error: PLANER[plan].slags === "aftale"
        ? "Kæde aftales direkte. Skriv til os."
        : "Enkeltkøb er ikke åbnet endnu.",
    });
    return;
  }

  const base = `https://${req.headers.host}`;
  try {
    const sess = await stripeKald("checkout/sessions", {
      mode: "subscription",
      line_items: [prisFor(plan)],
      // Kunden genbruges hvis kontoen har en. Ellers opretter Stripe en, og webhooken gemmer
      // id'et — uden det ville hver tegning lave en ny kunde for samme kontor.
      customer: konto.stripe_kunde_id || undefined,
      customer_email: konto.stripe_kunde_id ? undefined : (bruger && bruger.email) || undefined,
      // Kontoen rejser med, så webhooken ved hvem der betalte. Den er vores eneste bro
      // tilbage fra Stripe til databasen.
      client_reference_id: konto.id,
      subscription_data: { metadata: { konto_id: konto.id, plan } },
      metadata: { konto_id: konto.id, plan },
      allow_promotion_codes: true,
      // Momsen beregnes af Stripe Tax. Slås det ikke til i kontrolpanelet, fejler kaldet med
      // en tydelig besked frem for stille at sælge uden moms.
      automatic_tax: { enabled: true },
      success_url: `${base}/?betaling=ok`,
      cancel_url: `${base}/?betaling=afbrudt`,
    });
    res.status(200).json({ url: sess.url });
  } catch (err) {
    res.status(502).json({ error: err.message || "Kunne ikke starte betalingen." });
  }
}
