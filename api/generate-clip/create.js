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

// A plain-language reading of the status codes these services actually return, for the case
// where the body is empty and the number is all we have.
function forklarStatus(status) {
  if (status === 401 || status === 403) return "nøglen blev afvist — tjek at FAL_KEY er sat korrekt og er aktiv.";
  if (status === 402) return "der er ikke penge nok på kontoen hos udbyderen.";
  if (status === 404) return "modellen findes ikke på den adresse — model-id'et er sandsynligvis forkert.";
  if (status === 422) return "et af felterne blev afvist af modellen (forkert type eller værdi).";
  if (status === 429) return "for mange kald på for kort tid — prøv igen om lidt.";
  if (status >= 500) return "udbyderen har en driftsforstyrrelse — prøv igen om lidt.";
  return "intet svar fra udbyderen at vise.";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const { imageUrl, motion, model, aspectRatio, seed, quality } = req.body || {};
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
      quality: quality === "final" ? "final" : "test",
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

    // Retry on rate limiting. The app submits several clips at once to keep a 20-photo property
    // under a quarter of an hour, and a burst is exactly what providers throttle - so a 429 is an
    // expected part of normal operation here, not an error to hand the user.
    let r, text;
    for (let forsoeg = 0; ; forsoeg++) {
      r = await fetch(`https://queue.fal.run/${m.endpoint}`, {
        method: "POST",
        headers: falHeaders(key),
        body: JSON.stringify(input),
      });
      text = await r.text();
      if (r.status !== 429 || forsoeg >= 4) break;
      // Honour Retry-After when it is given; otherwise back off 2s, 4s, 8s, 16s.
      const efter = Number(r.headers.get("retry-after"));
      const vent = Number.isFinite(efter) && efter > 0 ? efter * 1000 : 2000 * Math.pow(2, forsoeg);
      await new Promise((res2) => setTimeout(res2, Math.min(vent, 20000)));
    }

    let data;
    try { data = JSON.parse(text); } catch (e) { data = null; }

    if (!r.ok) {
      // The STATUS CODE goes in the message, always. An earlier version passed through only the
      // response body, so an error with an empty body - which is exactly what 401 and 402 look
      // like - produced a blank message and hid the one fact needed to fix it.
      const raw = (data && (data.detail || data.error || data.message)) ?? null;
      const detail = raw == null || raw === ""
        ? (text.slice(0, 400) || forklarStatus(r.status))
        : (typeof raw === "string" ? raw : JSON.stringify(raw).slice(0, 400));
      res.status(r.status).json({
        error: `${m.label} afviste kaldet (HTTP ${r.status}): ${detail}`,
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
