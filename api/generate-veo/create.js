// Serverless function (Vercel) — starts one Veo clip for one room photo.
//
// Unlike the Luma path this needs no public image URL and no Blob store: Veo takes the photo as
// base64 in the request itself. The browser sends it already scaled down, both to stay under the
// request size limit and because a 2560px source is wasted on a model that returns 1080p.

import { VEO_BASE, VEO_MODEL, buildVeoRequest, veoKeyOrRespond, explainVeoStatus } from "../_veo.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const key = veoKeyOrRespond(res);
  if (!key) return;

  const { imageBase64, mimeType, motion, aspectRatio, dir, resolution } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== "string") {
    res.status(400).json({ error: "Mangler billedet." });
    return;
  }

  try {
    const r = await fetch(`${VEO_BASE}/models/${VEO_MODEL}:predictLongRunning`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(buildVeoRequest({ imageBase64, mimeType, motion, aspectRatio, dir, resolution })),
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }

    if (!r.ok) {
      const raw = data?.error?.message ?? null;
      const detail = raw || text.slice(0, 300) || explainVeoStatus(r.status);
      res.status(r.status).json({
        error: `Veo afviste kaldet (HTTP ${r.status}): ${detail}`,
        retryable: r.status === 429,
      });
      return;
    }

    // A long-running operation: the name is the handle everything else is done through.
    if (!data || !data.name) {
      res.status(502).json({ error: "Veo svarede uden et job-navn." });
      return;
    }
    res.status(200).json({ name: data.name });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke starte Veo-klippet: ${err.message}` });
  }
}
