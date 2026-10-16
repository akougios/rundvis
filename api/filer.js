// GEMTE FILER — logo, videoer og oprydning i ÉT endpoint.
//
// De tre var hver sin fil indtil Vercels Hobby-plan sagde fra: højst tolv serverless
// funktioner per deployment. Det er ikke en pæn grund til at lægge tre ting sammen, men det
// er en virkelig en, og de tre hører trods alt til samme bucket. Ruten vælges på ?hvad=.
//
// Logoet hænger på kontoen og bliver liggende; fire mæglere på samme kontor har samme logo.
// Videoen hænger på en sag og slettes efter tredive dage. Oprydningen kaldes af cron.

import { maaBruge } from "./_konto.js";
import {
  lagerErSat, laegOp, signeretOplaegning, signeretLink, slet,
  gemVideoRaekke, videorFor, rest,
} from "./_lager.js";

// Et logo er en streg og et navn, ikke et fotografi. Grænsen er her frem for kun i browseren,
// fordi en grænse der kun findes i frontenden ikke er en grænse.
const LOGO_MAKS = 512 * 1024;
const LOGO_TYPER = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const VIDEO_MAKS = 200 * 1024 * 1024;

export default async function handler(req, res) {
  const hvad = (req.query && req.query.hvad) || "";

  // Oprydningen først: den er den eneste der ikke har en bruger bag sig, og den skal kunne
  // svare uden at Supabase-login overhovedet er i spil.
  if (hvad === "ryd") {
    const forventet = process.env.CRON_HEMMELIGHED || "";
    const givet = (req.headers.authorization || "").replace(/^Bearer /, "");
    // Uden en hemmelighed sat er endpointet lukket. Fail closed: et åbent slette-endpoint er
    // værre end et der ikke virker.
    if (!forventet || givet !== forventet) { res.status(401).json({ error: "Ikke tilladt." }); return; }
    if (!lagerErSat()) { res.status(503).json({ error: "Lagring er ikke sat op." }); return; }
    try {
      const raekker = await rest("rpc/ryd_udloebne_videoer", { method: "POST", body: "{}" });
      const stier = (raekker || []).map((r) => (typeof r === "string" ? r : r.sti)).filter(Boolean);
      await slet(stier);
      res.status(200).json({ slettede: stier.length });
    } catch (err) {
      res.status(502).json({ error: err.message || "Oprydningen fejlede." });
    }
    return;
  }

  if (!lagerErSat()) { res.status(503).json({ error: "Lagring er ikke sat op endnu." }); return; }

  // Abonnement kræves ikke: logoet er en indstilling, og en gemt video er noget man allerede
  // har betalt for. Login kræves, for uden konto er der ingen at gemme for.
  const adgang = await maaBruge(req, res, { kraevAbonnement: false });
  if (!adgang) return;
  const { bruger, konto } = adgang;
  if (!konto) { res.status(403).json({ error: "Ingen konto fundet." }); return; }

  try {
    if (hvad === "logo") return await haandterLogo(req, res, konto);
    if (hvad === "video") return await haandterVideo(req, res, bruger, konto);
    res.status(400).json({ error: "Ukendt ?hvad=." });
  } catch (err) {
    res.status(502).json({ error: err.message || "Noget gik galt." });
  }
}

async function haandterLogo(req, res, konto) {
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
  if (LOGO_TYPER.indexOf(type) === -1) {
    res.status(400).json({ error: "Logoet skal være en PNG, JPG, SVG eller WEBP." });
    return;
  }
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > LOGO_MAKS) { res.status(413).json({ error: "Logoet må fylde højst 500 KB." }); return; }

  // Fast sti per konto. Så erstatter et nyt logo det gamle af sig selv, og vi samler ikke en
  // mappe med femten forsøg fra den samme mægler.
  const slut = type === "image/svg+xml" ? "svg" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const sti = `logo/${konto.id}/logo.${slut}`;
  await laegOp(sti, bytes, type, true);
  await rest(`konto?id=eq.${konto.id}`, {
    method: "PATCH",
    body: JSON.stringify({ logo_sti: sti, logo_navn: (filnavn || "logo").slice(0, 120) }),
  });
  res.status(200).json({ logo: { url: await signeretLink(sti), navn: filnavn || "logo" } });
}

// En færdig video fylder 20-30 MB. Vercel afviser en krop over 4,5 MB før funktionen bliver
// kaldt, så filen kan ikke gå gennem os. Derfor tre skridt: vi udsteder en signeret adresse,
// browseren lægger filen direkte op hos Supabase, og først derefter skrives rækken.
//
// Den rækkefølge er valgt med vilje. Fejler uploaden midtvejs, ligger der en fil uden række —
// spildplads, som oprydningen tager. Den omvendte rækkefølge ville give en række uden fil,
// altså en knap der fejler i hovedet på mægleren.
async function haandterVideo(req, res, bruger, konto) {
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
    const { boligId } = req.body || {};
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sti = `video/${konto.id}/${boligId || "uden-sag"}/${id}.webm`;
    res.status(200).json({ sti, uploadUrl: await signeretOplaegning(sti) });
    return;
  }

  if (handling === "registrer") {
    const { sti, navn, format, bytes, boligId } = req.body || {};
    // Stien skal ligge under kontoens egen mappe. Ellers kunne et kald registrere en andens
    // fil som sin egen og dermed læse den gennem vores signerede link.
    if (!sti || !String(sti).startsWith(`video/${konto.id}/`)) {
      res.status(400).json({ error: "Ugyldig sti." });
      return;
    }
    if (bytes && Number(bytes) > VIDEO_MAKS) { res.status(413).json({ error: "Videoen er for stor til at gemme." }); return; }
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
}
