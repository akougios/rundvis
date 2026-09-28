// Serverless function (Vercel) — polls one queued clip and, once it is done, returns the
// finished video's URL.
//
// The client polls this rather than fal directly, because the API key must never reach the
// browser. The URLs the client passes back are validated against a host allowlist first (see
// ../_fal.js) so this cannot be turned into a way of making our server fetch arbitrary URLs
// with our credentials attached.

import { assertFalUrl, falKeyOrRespond, falHeaders, lumaKeyOrRespond, LUMA_BASE, signVideoUrl } from "../_fal.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const { provider, id, statusUrl, responseUrl } = req.body || {};

  // Luma: one generation id, polled on Luma's own API.
  if (provider === "luma") {
    const lumaKey = lumaKeyOrRespond(res);
    if (!lumaKey) return;
    if (!id || typeof id !== "string") {
      res.status(400).json({ error: "Mangler generation-id." });
      return;
    }
    try {
      const lr = await fetch(`${LUMA_BASE}/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${lumaKey}` },
      });
      const data = await lr.json();
      if (!lr.ok) {
        res.status(lr.status).json({ error: `Luma-fejl: ${JSON.stringify(data).slice(0, 300)}` });
        return;
      }
      if (data.state === "failed") {
        res.status(502).json({ error: `Luma kunne ikke lave klippet: ${data.failure_reason || data.failure_code || "ukendt årsag"}` });
        return;
      }
      const out = Array.isArray(data.output) ? data.output.find((o) => o.url) || data.output[0] : null;
      if (data.state === "completed" && out && out.url) {
        // Signed here, so the proxy can prove this URL came from us (see api/proxy-video.js).
        res.status(200).json({ done: true, videoUrl: out.url, sig: await signVideoUrl(out.url) });
        return;
      }
      res.status(200).json({ done: false, status: data.state || "processing" });
      return;
    } catch (err) {
      res.status(500).json({ error: `Kunne ikke hente status: ${err.message}` });
      return;
    }
  }

  const key = falKeyOrRespond(res);
  if (!key) return;

  let safeStatus, safeResponse;
  try {
    safeStatus = assertFalUrl(statusUrl);
    safeResponse = assertFalUrl(responseUrl);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }

  try {
    const sr = await fetch(safeStatus, { headers: falHeaders(key) });
    const sText = await sr.text();
    let s;
    try { s = JSON.parse(sText); } catch (e) { s = null; }

    if (!sr.ok) {
      res.status(sr.status).json({ error: `Kunne ikke hente status: ${sText.slice(0, 200)}` });
      return;
    }

    const status = s && s.status;
    if (status !== "COMPLETED") {
      // IN_QUEUE / IN_PROGRESS. queue_position is present while queued and is worth showing.
      res.status(200).json({ done: false, status: status || "IN_PROGRESS", queuePosition: s && s.queue_position });
      return;
    }

    const rr = await fetch(safeResponse, { headers: falHeaders(key) });
    const rText = await rr.text();
    let out;
    try { out = JSON.parse(rText); } catch (e) { out = null; }

    if (!rr.ok) {
      res.status(rr.status).json({ error: `Kunne ikke hente videoen: ${rText.slice(0, 200)}` });
      return;
    }

    const videoUrl = out && out.video && out.video.url;
    if (!videoUrl) {
      res.status(502).json({ error: "Videotjenesten returnerede ikke nogen video." });
      return;
    }

    res.status(200).json({ done: true, videoUrl, sig: await signVideoUrl(videoUrl) });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke hente status: ${err.message}` });
  }
}
