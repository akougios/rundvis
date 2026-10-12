// Stripes egen kundeportal: skift plan, opdater kort, se fakturaer, opsig. Alt sammen noget vi
// ellers skulle bygge og vedligeholde, og noget en kunde har mere tillid til hos Stripe end hos
// en app de købte i går.

import { maaBruge } from "../_konto.js";
import { stripeKald, stripeErSat } from "../_stripe.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Kun POST er tilladt." }); return; }
  if (!stripeErSat()) { res.status(503).json({ error: "Betaling er ikke sat op endnu." }); return; }

  const adgang = await maaBruge(req, res, { kraevAbonnement: false });
  if (!adgang) return;
  const konto = adgang.konto;
  if (!konto || !konto.stripe_kunde_id) {
    res.status(400).json({ error: "Der er ikke tegnet et abonnement på kontoen endnu." });
    return;
  }

  try {
    const sess = await stripeKald("billing_portal/sessions", {
      customer: konto.stripe_kunde_id,
      return_url: `https://${req.headers.host}/`,
    });
    res.status(200).json({ url: sess.url });
  } catch (err) {
    res.status(502).json({ error: err.message || "Kunne ikke åbne kundeportalen." });
  }
}
