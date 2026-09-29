// Serverless function (Vercel) — polls one clip and returns its video URL once it is done.
// The browser polls this rather than Luma directly, so the API key never reaches the page.

import { LUMA_BASE, lumaKeyOrRespond, explainStatus, signVideoUrl } from "../_luma.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const key = lumaKeyOrRespond(res);
  if (!key) return;

  const { id } = req.body || {};
  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "Mangler id." });
    return;
  }

  try {
    const r = await fetch(`${LUMA_BASE}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = null; }

    if (!r.ok) {
      res.status(r.status).json({ error: `Luma-fejl (HTTP ${r.status}): ${text.slice(0, 200) || explainStatus(r.status)}` });
      return;
    }
    if (data.state === "failed") {
      res.status(502).json({ error: `Luma kunne ikke lave klippet: ${data.failure_reason || data.failure_code || "ukendt årsag"}` });
      return;
    }

    const out = Array.isArray(data.output) ? data.output.find((o) => o.url) || data.output[0] : null;
    if (data.state === "completed" && out && out.url) {
      // Signed so the proxy can prove this URL came from us (see api/proxy-video.js).
      res.status(200).json({ done: true, videoUrl: out.url, sig: await signVideoUrl(out.url) });
      return;
    }
    res.status(200).json({ done: false, status: data.state || "processing" });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke hente status: ${err.message}` });
  }
}
