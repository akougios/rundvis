// KONTORETS LOGO. Hænger på kontoen, ikke på brugeren: fire mæglere på samme kontor har
// samme logo, og den femte der logger ind skal ikke finde filen frem igen.
//
// POST gemmer en ny. GET giver et signeret link til den der ligger.

import { maaBruge } from "../_konto.js";
import { lagerErSat, laegOp, signeretLink, rest } from "../_lager.js";

// Et logo er en streg og et navn, ikke et fotografi. En halv megabyte er rigeligt, og
// grænsen er her frem for kun i browseren, fordi en grænse der kun findes i frontenden
// ikke er en grænse.
const MAKS_BYTES = 512 * 1024;
const TILLADTE = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

export default async function handler(req, res) {
  if (!lagerErSat()) { res.status(503).json({ error: "Lagring er ikke sat op endnu." }); return; }

  // Abonnement kræves ikke: logoet er en indstilling, ikke et forbrug. Den der har betalt
  // for en enkelt video skal også kunne sætte sit logo på den.
  const adgang = await maaBruge(req, res, { kraevAbonnement: false });
  if (!adgang) return;
  const { bruger, konto } = adgang;
  if (!konto) { res.status(403).json({ error: "Ingen konto fundet." }); return; }

  if (req.method === "GET") {
    if (!konto.logo_sti) { res.status(200).json({ logo: null }); return; }
    const link = await signeretLink(konto.logo_sti);
    res.status(200).json({ logo: link ? { url: link, navn: konto.logo_navn || "logo" } : null });
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "Kun GET og POST." }); return; }

  const { dataUrl, filnavn } = req.body || {};
  if (!dataUrl) { res.status(400).json({ error: "Mangler dataUrl." }); return; }

  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) { res.status(400).json({ error: "Ugyldigt billedformat." }); return; }
  const type = m[1];
  if (TILLADTE.indexOf(type) === -1) {
    res.status(400).json({ error: "Logoet skal være en PNG, JPG, SVG eller WEBP." });
    return;
  }
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAKS_BYTES) {
    res.status(413).json({ error: "Logoet må fylde højst 500 KB." });
    return;
  }

  try {
    // Fast sti per konto. Så erstatter et nyt logo det gamle af sig selv, og vi samler ikke
    // en mappe med femten forsøg fra den samme mægler.
    const slut = type === "image/svg+xml" ? "svg" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const sti = `logo/${konto.id}/logo.${slut}`;
    await laegOp(sti, bytes, type, true);
    await rest(`konto?id=eq.${konto.id}`, {
      method: "PATCH",
      body: JSON.stringify({ logo_sti: sti, logo_navn: (filnavn || "logo").slice(0, 120) }),
    });
    const link = await signeretLink(sti);
    res.status(200).json({ logo: { url: link, navn: filnavn || "logo" } });
  } catch (err) {
    res.status(502).json({ error: err.message || "Kunne ikke gemme logoet." });
  }
}
