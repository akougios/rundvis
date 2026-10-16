// FILER DER SKAL OVERLEVE AT FANEN LUKKES.
//
// Logoet og de færdige videoer. Begge ligger i den samme private bucket i Supabase Storage,
// adskilt af stien: logo/<konto>/… og video/<konto>/<bolig>/….
//
// Alt går gennem service-nøglen, aldrig gennem browseren. To grunde. Bucket'en er privat,
// fordi en boligvideo er mæglerens materiale før boligen er annonceret, og en offentlig
// bucket med gættelige stier er ingen adgangskontrol. Og rækken i gemt_video skal skrives
// i samme kald som filen lægges op, så en række aldrig kan pege på en fil der ikke findes.
//
// Læsning sker med signerede links der udløber. Ikke af hemmelighedskræmmeri: et link uden
// udløb der havner i en mail, er en permanent offentlig adresse til kundens materiale.

const url = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const service = () => process.env.SUPABASE_SERVICE_KEY || "";
const BUCKET = "rundvis";

// Hvor længe et download-link holder. Ti minutter er rigeligt til at hente en fil og for
// kort til at være værd at dele videre.
const LINK_SEKUNDER = 600;

export function lagerErSat() {
  return Boolean(url() && service());
}

function hoveder(ekstra) {
  return { apikey: service(), Authorization: `Bearer ${service()}`, ...(ekstra || {}) };
}

// Lægger bytes op på en sti. upsert, så et nyt logo erstatter det gamle frem for at samle
// dem — kontoret har ét logo, ikke en historik.
export async function laegOp(sti, bytes, type, upsert = true) {
  const r = await fetch(`${url()}/storage/v1/object/${BUCKET}/${sti}`, {
    method: "POST",
    headers: hoveder({ "Content-Type": type || "application/octet-stream", "x-upsert": upsert ? "true" : "false" }),
    body: bytes,
  });
  if (!r.ok) throw new Error(`Kunne ikke gemme filen (${r.status}).`);
  return sti;
}

// En færdig video fylder 20-30 MB, og Vercel afviser en krop over 4,5 MB før funktionen
// overhovedet bliver kaldt. Så filen kan ikke gå gennem os. I stedet får browseren en
// signeret adresse den må lægge op til, én gang, direkte hos Supabase.
export async function signeretOplaegning(sti) {
  const r = await fetch(`${url()}/storage/v1/object/upload/sign/${BUCKET}/${sti}`, {
    method: "POST",
    headers: hoveder({ "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`Kunne ikke klargøre uploaden (${r.status}).`);
  const j = await r.json().catch(() => null);
  if (!j || !j.url) throw new Error("Fik ingen adresse at lægge op til.");
  return `${url()}/storage/v1${j.url}`;
}

export async function signeretLink(sti) {
  const r = await fetch(`${url()}/storage/v1/object/sign/${BUCKET}/${sti}`, {
    method: "POST",
    headers: hoveder({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: LINK_SEKUNDER }),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j && j.signedURL ? `${url()}/storage/v1${j.signedURL}` : null;
}

export async function slet(stier) {
  const liste = (stier || []).filter(Boolean);
  if (!liste.length) return;
  await fetch(`${url()}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: hoveder({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: liste }),
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Rækkerne.

export async function rest(sti, init) {
  const r = await fetch(`${url()}/rest/v1/${sti}`, {
    ...init,
    headers: hoveder({ "Content-Type": "application/json", ...(init && init.headers) }),
  });
  if (!r.ok) throw new Error(`Databasen svarede ${r.status}.`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

export async function gemVideoRaekke(linje) {
  return rest("gemt_video", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(linje),
  });
}

// Videoerne for en konto, nyeste først. Udløbne rækker kan nå at ligge her indtil
// oprydningen kører, så de filtreres fra her også — en mægler skal ikke se en knap der
// fejler, bare fordi cron-jobbet kører om fire timer.
export async function videorFor(kontoId) {
  const rows = await rest(
    `gemt_video?konto_id=eq.${kontoId}&udloeber=gt.${encodeURIComponent(new Date().toISOString())}` +
    `&select=id,navn,format,bytes,oprettet,udloeber&order=oprettet.desc&limit=50`,
    { method: "GET" },
  );
  return rows || [];
}
