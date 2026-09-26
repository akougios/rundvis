// Serverless function (Vercel) — starts ONE Luma Ray AI video clip for the
// "arrival": the camera moves from the exterior facade photo, forward and
// through the front door, then continues into the first couple of rooms.
//
// KEY INSIGHT (after several failed attempts): giving Luma only 2 very
// different images (facade + interior) to interpolate between is genuinely
// ambiguous for the model - it has only the text prompt to infer direction
// from, which proved unreliable no matter how the prompt was worded or
// which API mode was used (2-point start_frame/end_frame and multi-keyframe
// with just 2 keyframes both sometimes produced backward/pull-away motion).
// The one version that DID work reliably gave Luma the full ordered photo
// sequence (facade -> entry -> room -> room -> ...): with more keyframes,
// each next image is visibly "further into the house" than the last, so
// the sequence itself carries a strong directional signal Luma can follow
// - not just the prompt. This keeps that "more keyframes = clearer
// direction" property, but caps it at ENTRY_KEYFRAME_COUNT images (facade,
// entry, and a couple more rooms) instead of the whole house, to keep cost
// down. The rest of the uploaded photos are shown as a Ken-Burns pan/zoom
// montage entirely client-side (see public/index.html) - no AI there, so
// no risk of AI artifacts, and no extra Luma cost for those rooms.
//
// video.keyframes / video.keyframe_indexes (multi-keyframe mode) - up to
// 64 images per call, keyframe_indexes are frame positions on a
// duration x 24fps grid. 5s only when there are just 2 images; 10s
// whenever there are more, so later frames still get real screen time.
//
// NOTE: Luma retired the legacy api.lumalabs.ai/dream-machine/v1 API in
// favor of the new Agents API (agents.lumalabs.ai/v1). New API keys (the
// "luma-api-..." keys issued from platform.lumalabs.ai) only work against
// the new API.

const LUMA_BASE = "https://agents.lumalabs.ai/v1/generations";
const FPS = 24;
const ENTRY_KEYFRAME_COUNT = 4; // facade + entry + up to 2 more rooms, at most

const ENTRY_PROMPT =
  "Camera push in, dolly forward, slow and steady. " +
  "Smooth, continuous real-estate walkthrough video shot from a single " +
  "moving camera that only ever moves forward, in the same order the " +
  "images are given: starting outside showing the building's facade, " +
  "advancing toward and through the front door, then continuing forward " +
  "from room to room in the exact sequence provided, at an unhurried, " +
  "gentle pace, lingering briefly in each space. Push in the entire time " +
  "- the camera never pulls back, never dollies out, never zooms out, " +
  "never reveals the building from further away, never reverses " +
  "direction, and never revisits a view it has already passed through. " +
  "Forward motion only, from start to finish. Smooth, slow, deliberate, " +
  "professional real estate videography, photorealistic, level horizon, " +
  "no distortion.";

function buildKeyframeIndexes(count, maxFrame) {
  const raw = Array.from({ length: count }, (_, i) =>
    count === 1 ? 0 : Math.round((i * maxFrame) / (count - 1))
  );
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] <= raw[i - 1]) raw[i] = raw[i - 1] + 1;
  }
  if (raw[raw.length - 1] > maxFrame) raw[raw.length - 1] = maxFrame;
  return raw;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const apiKey = process.env.LUMA_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Serveren mangler en LUMA_API_KEY. Sæt den under Vercel → Settings → Environment Variables.",
    });
    return;
  }

  const { imageUrls, aspectRatio } = req.body || {};

  if (!Array.isArray(imageUrls) || imageUrls.length < 2) {
    res.status(400).json({ error: "Mangler mindst 2 billed-URL'er (facade og indgangsbillede)." });
    return;
  }

  const used = imageUrls.slice(0, ENTRY_KEYFRAME_COUNT);
  const duration = used.length > 2 ? "10s" : "5s";
  const maxFrame = (used.length > 2 ? 10 : 5) * FPS;
  const keyframeIndexes = buildKeyframeIndexes(used.length, maxFrame);

  try {
    const lumaRes = await fetch(LUMA_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "ray-3.2",
        type: "video",
        prompt: ENTRY_PROMPT,
        aspect_ratio: aspectRatio || "9:16",
        video: {
          resolution: "720p",
          duration,
          keyframes: used.map((url) => ({ url })),
          keyframe_indexes: keyframeIndexes,
        },
      }),
    });

    const data = await lumaRes.json();
    if (!lumaRes.ok) {
      res.status(lumaRes.status).json({ error: `Luma-fejl: ${JSON.stringify(data)}` });
      return;
    }

    res.status(200).json({ id: data.id, state: data.state, keyframeCount: used.length });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke starte indgangsklippet: ${err.message}` });
  }
}
