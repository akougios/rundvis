// GEMTE VIDEOER.
//
// En færdig video fylder 20-30 MB. Vercel afviser en krop over 4,5 MB før funktionen bliver
// kaldt, så filen kan ikke gå gennem os. Derfor tre skridt: vi udsteder en signeret adresse,
// browseren lægger filen direkte op hos Supabase, og først derefter skrives rækken.
//
// Den rækkefølge er valgt med vilje. Fejler uploaden midtvejs, ligger der en fil uden række —
// spildplads, som oprydningen tager. Den omvendte rækkefølge ville give en række uden fil,
// altså en knap der fejler i hovedet på mægleren.

import { maaBruge } from "../_konto.js";
import { lagerErSat, signeretOplaegning, signeretLink, slet, gemVideoRaekke, videorFor, rest } from "../_lager.js";

const MAKS_BYTES = 200 * 1024 * 1024;

export default async function handler(req, res) {
  if (!lagerErSat()) { res.status(503).json({ error: "Lagring er ikke sat op endnu." }); return; }

  const adgang = await maaBruge(req, res, { kraevAbonnement: false });
  if (!adgang) return;
  const { bruger, konto } = adgang;
  if (!konto) { res.status(403).json({ error: "Ingen konto fundet." }); return; }

  try {
    if (req.method === "GET") {
      res.status(200).json({ videoer: await videorFor(konto.id) });
      return;
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};
      if (!id) { res.status(400).json({ error: "Mangler id." }); return; }
      // Hentes først, så vi kan slette filen — og så vi ser at rækken hører til DENNE konto.
      // Uden det kunne et gæt på et id slette en andens video.
      const rows = await rest(`gemt_video?id=eq.${id}&konto_id=eq.${konto.id}&select=sti`, { method: "GET" });
      if (!rows || !rows.length) { res.status(404).json({ error: "Videoen findes ikke." }); return; }
      await rest(`gemt_video?id=eq.${id}&konto_id=eq.${konto.id}`, { method: "DELETE" });
      await slet([rows[0].sti]);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method !== "POST") { res.status(405).json({ error: "Kun GET, POST og DELETE." }); return; }

    const { handling } = req.body || {};

    if (handling === "url") {
      const { format, boligId } = req.body || {};
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sti = `video/${konto.id}/${boligId || "uden-sag"}/${id}.webm`;
      res.status(200).json({ sti, uploadUrl: await signeretOplaegning(sti) });
      return;
    }

    if (handling === "registrer") {
      const { sti, navn, format, bytes, boligId } = req.body || {};
      // Stien skal ligge under kontoens egen mappe. Ellers kunne et kald registrere en
      // andens fil som sin egen og dermed læse den gennem vores signerede link.
      if (!sti || !String(sti).startsWith(`video/${konto.id}/`)) {
        res.status(400).json({ error: "Ugyldig sti." });
        return;
      }
      if (bytes && Number(bytes) > MAKS_BYTES) {
        res.status(413).json({ error: "Videoen er for stor til at gemme." });
        return;
      }
      const raekke = await gemVideoRaekke({
        konto_id: konto.id,
        bolig_id: boligId || null,
        bruger_id: bruger ? bruger.id : null,
        sti,
        navn: (navn || "Video").slice(0, 160),
        format: format || null,
        bytes: bytes ? Number(bytes) : null,
      });
      res.status(200).json({ video: Array.isArray(raekke) ? raekke[0] : raekke });
      return;
    }

    if (handling === "link") {
      const { id } = req.body || {};
      const rows = await rest(`gemt_video?id=eq.${id}&konto_id=eq.${konto.id}&select=sti,navn`, { method: "GET" });
      if (!rows || !rows.length) { res.status(404).json({ error: "Videoen findes ikke." }); return; }
      res.status(200).json({ url: await signeretLink(rows[0].sti), navn: rows[0].navn });
      return;
    }

    res.status(400).json({ error: "Ukendt handling." });
  } catch (err) {
    res.status(502).json({ error: err.message || "Noget gik galt." });
  }
}
