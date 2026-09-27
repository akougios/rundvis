// Serverless function (Vercel, Edge runtime) — streams a generated clip back through our own
// domain.
//
// WHY THIS EXISTS. The finished clips live on fal's media hosts. Drawing a video from another
// origin onto a canvas marks that canvas as "tainted", and a tainted canvas cannot be read back
// - which kills both the frame compositing the player does and the MediaRecorder export. Served
// from our own origin instead, there is nothing to taint and everything downstream keeps working
// whatever CORS headers fal happens to send.
//
// Edge runtime on purpose: it streams the response straight through, so a 10 MB clip is not held
// in memory and does not run into the response size cap that applies to ordinary serverless
// functions.

export const config = { runtime: "edge" };

// Only fal's own media hosts. Without this the endpoint would happily fetch anything on the
// internet on a caller's behalf.
function allowed(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch (e) {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return u.hostname === "fal.media" || u.hostname.endsWith(".fal.media") || u.hostname.endsWith(".fal.run");
}

export default async function handler(req) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url || !allowed(url)) {
    return new Response(JSON.stringify({ error: "Ugyldig eller ikke-tilladt video-URL." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Range headers are passed through so the browser can seek within the clip.
  const range = req.headers.get("range");
  const upstream = await fetch(url, { headers: range ? { Range: range } : {} });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response(JSON.stringify({ error: `Kunne ikke hente videoen (${upstream.status}).` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("content-type")) headers.set("content-type", "video/mp4");
  // Generated clips never change once produced, so they can be cached hard.
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(upstream.body, { status: upstream.status, headers });
}
