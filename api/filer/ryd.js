// OPRYDNINGEN. Kaldes af Vercels cron én gang i døgnet, se vercel.json.
//
// Sletter rækker der er løbet ud og derefter deres filer. Beskyttet af CRON_HEMMELIGHED,
// fordi et slette-endpoint uden lås er en knap enhver kan trykke på.

import { lagerErSat, slet, rest } from "../_lager.js";

export default async function handler(req, res) {
  const forventet = process.env.CRON_HEMMELIGHED || "";
  const givet = (req.headers.authorization || "").replace(/^Bearer /, "");
  // Uden en hemmelighed sat er endpointet lukket. Fail closed: et åbent slette-endpoint er
  // værre end et der ikke virker.
  if (!forventet || givet !== forventet) { res.status(401).json({ error: "Ikke tilladt." }); return; }
  if (!lagerErSat()) { res.status(503).json({ error: "Lagring er ikke sat op." }); return; }

  try {
    const stier = await rest("rpc/ryd_udloebne_videoer", { method: "POST", body: "{}" });
    const liste = (stier || []).map((r) => (typeof r === "string" ? r : r.sti)).filter(Boolean);
    await slet(liste);
    res.status(200).json({ slettede: liste.length });
  } catch (err) {
    res.status(502).json({ error: err.message || "Oprydningen fejlede." });
  }
}
