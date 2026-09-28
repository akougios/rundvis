// Serverless function (Vercel, Edge runtime) — streams a generated clip back through our own
// domain.
//
// WHY THIS EXISTS. The finished clips live on the video provider's media hosts. Drawing a video
// from another origin onto a canvas marks that canvas as "tainted", and a tainted canvas cannot
// be read back - which kills both the frame compositing the player does and the MediaRecorder
// export. Served from our own origin instead, there is nothing to taint and everything
// downstream keeps working whatever CORS headers the provider happens to send.
//
// WHY SIGNATURES RATHER THAN A HOST ALLOWLIST. The obvious guard is a list of permitted
// hostnames, but a CDN host has to be guessed: too narrow and clips fail to play, too broad and
// this becomes an open proxy (an earlier version allowed *.amazonaws.com, i.e. every S3 bucket
// in existence). The URL is instead signed by the status endpoint at the moment it is handed to
// the browser, and refused here without a matching signature. Provenance is proven, not guessed,
// and a new provider needs no change here at all.
//
// Edge runtime on purpose: it streams the response straight through, so a 10 MB clip is not held
// in memory and does not run into the response size cap that applies to ordinary serverless
// functions.

import { verifyVideoUrl } from "./_fal.js";

export const config = { runtime: "edge" };

function bad(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  const params = new URL(req.url).searchParams;
  const url = params.get("url");
  const sig = params.get("sig");

  if (!url || !/^https:\/\//.test(url)) return bad(400, "Ugyldig video-URL.");
  if (!(await verifyVideoUrl(url, sig))) return bad(403, "Video-URL'en er ikke signeret af serveren.");

  // Range headers are passed through so the browser can seek within the clip.
  const range = req.headers.get("range");
  const upstream = await fetch(url, { headers: range ? { Range: range } : {} });
  if (!upstream.ok && upstream.status !== 206) {
    return bad(502, `Kunne ikke hente videoen (${upstream.status}).`);
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
