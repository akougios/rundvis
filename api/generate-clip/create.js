// Serverless function (Vercel) — starts ONE image-to-video clip for a single room photo.
//
// The prompt work is the whole game here. An image-to-video model will happily redecorate a
// room if you let it, and for a listing video that is worse than no motion at all: the video
// must show the property that is actually for sale. So every prompt below says what the CAMERA
// does and states, repeatedly and concretely, that the room itself must not change.

import { resolveModel, falKeyOrRespond, falHeaders, lumaKeyOrRespond, LUMA_BASE } from "../_fal.js";

// Shared across every shot. Kept short and concrete - long flowery prompts make these models
// invent atmosphere, which is exactly what we do not want.
const BASE_PROMPT =
  "Real estate listing video of this exact room. Photorealistic, filmed on a gimbal. " +
  "The room, the furniture, the light and the view through the windows all stay exactly as " +
  "they are in the photo: nothing moves, nothing changes shape, nothing is added or removed. " +
  "No people, no animals, no text. Only the camera moves.";

// One line per shot type, matching the 2D storyboard the agent already approved, so the
// generated clip moves the same way the preview promised.
const MOTION = {
  push: "The camera moves slowly and steadily forward into the room.",
  pull: "The camera moves slowly and steadily backwards, revealing more of the room.",
  pan: "The camera tracks slowly and steadily sideways across the room, staying level.",
  drift: "The camera drifts slowly and steadily across the room in a smooth diagonal.",
  orbit: "The camera arcs slowly and steadily sideways around the room, staying level.",
};

// Names the failure modes these models actually produce on interiors, rather than generic
// "low quality" filler.
const NEGATIVE_PROMPT =
  "warping, morphing, melting, distortion, bending walls, curved straight lines, wobbling " +
  "furniture, flickering, changing layout, new objects appearing, people, animals, text, " +
  "watermark, logo, blur, low quality, camera shake, fast motion, zoom jitter";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const { imageUrl, motion, model, aspectRatio, seed } = req.body || {};
  if (!imageUrl || typeof imageUrl !== "string" || !/^https:\/\//.test(imageUrl)) {
    res.status(400).json({ error: "Mangler et gyldigt billede-URL (https)." });
    return;
  }

  const m = resolveModel(model);
  const motionLine = MOTION[motion] || MOTION.push;

  // Each provider needs its own key, so which one is missing depends on the chosen model.
  const key = m.provider === "luma" ? lumaKeyOrRespond(res) : falKeyOrRespond(res);
  if (!key) return;

  try {
    const input = m.build({
      imageUrl,
      prompt: `${BASE_PROMPT} ${motionLine}`,
      negativePrompt: NEGATIVE_PROMPT,
      aspectRatio,
      motion,
      // Only used by models that support it; a fixed seed per photo index means a regenerated
      // walkthrough is identical on those models.
      seed: typeof seed === "number" ? seed : undefined,
    });

    // Luma is called directly and answers with a generation id to poll; fal answers with
    // absolute queue URLs. The client is handed whichever shape applies, tagged with the
    // provider so the status endpoint knows how to read it.
    if (m.provider === "luma") {
      const lr = await fetch(LUMA_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(input),
      });
      const lText = await lr.text();
      let lData;
      try { lData = JSON.parse(lText); } catch (e) { lData = null; }
      if (!lr.ok) {
        res.status(lr.status).json({ error: `${m.label} afviste kaldet: ${lText.slice(0, 400)}` });
        return;
      }
      res.status(200).json({ provider: "luma", id: lData.id, model: m.key, modelLabel: m.label });
      return;
    }

    const r = await fetch(`https://queue.fal.run/${m.endpoint}`, {
      method: "POST",
      headers: falHeaders(key),
      body: JSON.stringify(input),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = null; }

    if (!r.ok) {
      // fal's validation errors name the offending field, which is exactly what is needed when
      // a model's schema differs from what the registry assumed - so it is passed through
      // rather than replaced with something generic.
      const detail = (data && (data.detail || data.error || data.message)) || text.slice(0, 400);
      res.status(r.status).json({
        error: `${m.label} afviste kaldet: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
      });
      return;
    }

    // fal returns absolute URLs for polling; they are handed straight back to the client and
    // checked again against an allowlist when they come back (see ../_fal.js).
    res.status(200).json({
      provider: "fal",
      requestId: data.request_id,
      statusUrl: data.status_url,
      responseUrl: data.response_url,
      model: m.key,
      modelLabel: m.label,
    });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke starte videoklippet: ${err.message}` });
  }
}
