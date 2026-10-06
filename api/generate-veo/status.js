// Serverless function (Vercel) — polls one Veo job and hands back a playable URL.
//
// The finished clip sits behind a Google URL that only opens with the API key, so it cannot go
// straight into a <video> element. It is signed here and served through /api/proxy-video, which
// is the same route a Luma clip takes - the proxy verifies the signature rather than guessing at
// hostnames, so a second provider needs nothing added to it beyond the key for this one host.

import { VEO_BASE, veoKeyOrRespond, veoVideoFrom, explainVeoStatus } from "../_veo.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const key = veoKeyOrRespond(res);
  if (!key) return;

  const { name } = req.body || {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Mangler job-navnet." });
    return;
  }

  try {
    const r = await fetch(`${VEO_BASE}/${name}`, { headers: { "x-goog-api-key": key } });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }

    if (!r.ok) {
      const raw = data?.error?.message ?? null;
      res.status(r.status).json({
        error: `Kunne ikke hente status (HTTP ${r.status}): ${raw || explainVeoStatus(r.status)}`,
      });
      return;
    }

    if (!data || !data.done) {
      res.status(200).json({ done: false });
      return;
    }
    if (data.error) {
      res.status(200).json({ done: true, error: data.error.message || "Veo kunne ikke lave klippet." });
      return;
    }

    const video = await veoVideoFrom(data);
    if (!video) {
      res.status(200).json({ done: true, error: "Veo blev færdig uden at aflevere en video." });
      return;
    }
    res.status(200).json({ done: true, videoUrl: video.url, sig: video.sig });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke hente status: ${err.message}` });
  }
}
