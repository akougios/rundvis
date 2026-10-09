// Serverless function (Vercel) — starts one Veo clip for one room photo.
//
// Unlike the Luma path this needs no public image URL and no Blob store: Veo takes the photo as
// base64 in the request itself. The browser sends it already scaled down, both to stay under the
// request size limit and because a 2560px source is wasted on a model that returns 1080p.

import { VEO_BASE, VEO_MODEL, VEO_IMAGE_SHAPES, buildVeoRequest, veoKeyOrRespond, explainVeoStatus } from "../_veo.js";

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
    // The image field is sent one way, and if the model refuses that field, the other way. See
    // VEO_IMAGE_SHAPES: the documentation and the live API disagree about which it wants.
    let r, text, data, used;
    const tried = [];
    for (const shape of VEO_IMAGE_SHAPES) {
      used = shape;
      r = await fetch(`${VEO_BASE}/models/${VEO_MODEL}:predictLongRunning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(buildVeoRequest({ imageBase64, mimeType, motion, aspectRatio, dir, resolution, shape })),
      });
      text = await r.text();
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (r.ok) break;
      const msg = data?.error?.message || "";
      tried.push(`${shape}: ${msg.slice(0, 120) || r.status}`);
      // Only worth trying the other shape when it is the FIELD that was refused. A rejected key,
      // a missing payment method or an image that is too large will fail the same way twice, and
      // sending the photo a second time for nothing just doubles the wait.
      const aboutTheField = r.status === 400 && /inlinedata|bytesbase64encoded|image/i.test(msg);
      if (!aboutTheField) break;
    }

    if (!r.ok) {
      const raw = data?.error?.message ?? null;
      const detail = raw || text.slice(0, 300) || explainVeoStatus(r.status);
      res.status(r.status).json({
        error: `Veo afviste kaldet (HTTP ${r.status}): ${detail}`,
        tried,
        retryable: r.status === 429,
      });
      return;
    }

    // A long-running operation: the name is the handle everything else is done through.
    if (!data || !data.name) {
      res.status(502).json({ error: "Veo svarede uden et job-navn." });
      return;
    }
    // Reported back so the shape that works only has to be discovered once.
    res.status(200).json({ name: data.name, imageShape: used });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke starte Veo-klippet: ${err.message}` });
  }
}
