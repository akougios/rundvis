// Stripe fortæller os hvad der skete. Det er det ENESTE sted abonnementsstatus sættes — en
// bruger der kunne skrive sin egen status, havde gratis adgang for evigt.
//
// Kroppen skal læses rå. Vercel ville ellers fortolke den, og et genserialiseret JSON-objekt
// har ikke samme bytes som det Stripe signerede.

import { verificerWebhook, raaKrop } from "../_stripe.js";
import { PLANER } from "../_stripe.js";

export const config = { api: { bodyParser: false } };

const sb = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const service = () => process.env.SUPABASE_SERVICE_KEY || "";

async function opdaterKonto(kontoId, felter) {
  if (!sb() || !service() || !kontoId) return false;
  const r = await fetch(`${sb()}/rest/v1/konto?id=eq.${kontoId}`, {
    method: "PATCH",
    headers: {
      apikey: service(), Authorization: `Bearer ${service()}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
    },
    body: JSON.stringify(felter),
  });
  return r.ok;
}

// Stripes statusser er flere end vi har brug for. Kun "active" og "trialing" giver adgang;
// alt andet gør ikke, og det er med vilje at listen er kort frem for klog.
function tilVoresStatus(stripeStatus) {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "aktiv";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "forfalden";
  return "opsagt";
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }

  const raa = await raaKrop(req);
  const h = await verificerWebhook(raa, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  if (!h) { res.status(400).json({ error: "Signaturen holdt ikke." }); return; }

  const o = (h.data && h.data.object) || {};
  const kontoId = (o.metadata && o.metadata.konto_id) || o.client_reference_id || null;

  try {
    if (h.type === "checkout.session.completed") {
      // Her lærer vi kundens og abonnementets id at kende. Uden dem kan kundeportalen ikke
      // åbnes senere.
      const plan = (o.metadata && o.metadata.plan) || "kontor";
      await opdaterKonto(kontoId, {
        stripe_kunde_id: o.customer || null,
        stripe_abonnement_id: o.subscription || null,
        abonnement_status: "aktiv",
        inkluderede_boliger: (PLANER[plan] || PLANER.kontor).inkluderede,
      });
    } else if (h.type.startsWith("customer.subscription.")) {
      const slettet = h.type === "customer.subscription.deleted";
      const plan = (o.metadata && o.metadata.plan) || null;
      const felter = {
        stripe_abonnement_id: o.id || null,
        abonnement_status: slettet ? "opsagt" : tilVoresStatus(o.status),
        periode_slut: o.current_period_end ? new Date(o.current_period_end * 1000).toISOString() : null,
      };
      if (plan && PLANER[plan]) felter.inkluderede_boliger = PLANER[plan].inkluderede;
      await opdaterKonto(kontoId, felter);
    } else if (h.type === "invoice.payment_failed") {
      await opdaterKonto(kontoId, { abonnement_status: "forfalden" });
    }
  } catch (e) {
    // Svar alligevel 200. Stripe prøver igen ved en fejl, og et gentaget forsøg på noget der
    // allerede er skrevet, gør ingen skade — men en fejlkode her får dem til at prøve i dagevis.
  }

  res.status(200).json({ modtaget: true });
}
