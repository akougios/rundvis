// Serverless function (Vercel) — starts ONE image-to-video clip for a single room photo.
//
// The prompt work is the whole game here. An image-to-video model will happily redecorate a
// room if you let it, and for a listing video that is worse than no motion at all: the video
// must show the property that is actually for sale. So every prompt below says what the CAMERA
// does and states, repeatedly and concretely, that the room itself must not change.

import { FAL_MODEL, falKeyOrRespond, falHeaders } from "../_fal.js";

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

const NEGATIVE_PROMPT =
  "warping, morphing, melting, distortion, bending walls, curved straight lines, wobbling " +
  "furniture, flickering, changing layout, new objects appearing, people, animals, text, " +
  "watermark, logo, blur, low quality, camera shake, fast motion, zoom jitter";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const key = falKeyOrRespond(res);
  if (!key) return;

  const { imageUrl, motion, duration } = req.body || {};
  if (!imageUrl || typeof imageUrl !== "string" || !/^https:\/\//.test(imageUrl)) {
    res.status(400).json({ error: "Mangler et gyldigt billede-URL (https)." });
    return;
  }

  const motionLine = MOTION[motion] || MOTION.push;
  // 5s is this model's shortest clip. That suits us: the edit only uses the first couple of
  // seconds of each clip, and the opening seconds are where the model stays closest to the
  // original photograph - drift grows the longer it runs.
  const seconds = duration === 10 ? "10" : "5";

  try {
    const r = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
      method: "POST",
      headers: falHeaders(key),
      body: JSON.stringify({
        prompt: `${BASE_PROMPT} ${motionLine}`,
        start_image_url: imageUrl,
        duration: seconds,
        negative_prompt: NEGATIVE_PROMPT,
        // Audio would be generated speech or ambience we do not want, and it roughly doubles
        // the price per second.
        generate_audio: false,
      }),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = null; }

    if (!r.ok) {
      const detail = (data && (data.detail || data.error || data.message)) || text.slice(0, 300);
      res.status(r.status).json({ error: `Videotjenesten afviste kaldet: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` });
      return;
    }

    // fal returns absolute URLs for polling; they are handed straight back to the client and
    // checked again against an allowlist when they come back (see ../_fal.js).
    res.status(200).json({
      requestId: data.request_id,
      statusUrl: data.status_url,
      responseUrl: data.response_url,
    });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke starte videoklippet: ${err.message}` });
  }
}
