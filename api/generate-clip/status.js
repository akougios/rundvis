// Serverless function (Vercel) — polls one queued clip and, once it is done, returns the
// finished video's URL.
//
// The client polls this rather than fal directly, because the API key must never reach the
// browser. The URLs the client passes back are validated against a host allowlist first (see
// ../_fal.js) so this cannot be turned into a way of making our server fetch arbitrary URLs
// with our credentials attached.

import { assertFalUrl, falKeyOrRespond, falHeaders } from "../_fal.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const key = falKeyOrRespond(res);
  if (!key) return;

  const { statusUrl, responseUrl } = req.body || {};
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

    res.status(200).json({ done: true, videoUrl });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke hente status: ${err.message}` });
  }
}
