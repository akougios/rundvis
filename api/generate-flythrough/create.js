// Serverless function (Vercel) — starts ONE Luma Ray AI video clip for the
// "arrival": the camera starts on the exterior facade photo and moves
// forward, through the front door, then continues into the first couple of
// rooms.
//
// KEY INSIGHT (after several failed attempts): giving Luma only 2 very
// different images (facade + interior) to interpolate between is genuinely
// ambiguous for the model - it has only the text prompt to infer direction
// from, which proved unreliable no matter how the prompt was worded or
// which API mode was used (2-point start_frame/end_frame and multi-keyframe
// with just 2 keyframes both sometimes produced backward/pull-away motion).
// The version that works reliably gives Luma the full ordered photo
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
// On top of the image sequence and the text prompt, this also sends Luma's
// structured "camera concept" `push_in` (see docs.lumalabs.ai/changelog/
// concepts) as an explicit machine-readable motion hint, not just prose -
// this is a documented feature for plain text-to-video / single-image
// requests, but Luma's docs don't confirm it's supported together with
// multi-keyframe requests, so the concepts field is tried first and the
// call is retried once WITHOUT it if Luma rejects the request because of
// it. That keeps this from ever hard-failing over an unsupported field.
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

// Deliberately over-explicit and repetitive: spells out exactly what the
// FIRST frame shows and what the camera must do from that exact position,
// rather than only describing the overall feel. Luma's model appears to
// weigh the opening sentences most heavily, so the frame-1 description and
// the "never move away" instruction are stated first, restated, and
// reinforced with concrete failure cases to avoid.
const ENTRY_PROMPT =
  "The very first frame of this video already shows the exterior of a " +
  "house from the outside, facade fully visible, camera stationary, " +
  "nothing else - this is the fixed starting position, do not move away " +
  "from it or reveal more of the exterior than is already visible in " +
  "frame one. " +
  "From that exact starting position, the camera moves forward: a slow, " +
  "smooth, steady walk-in toward the building, straight ahead, getting " +
  "closer to the front door with every frame, then passing through the " +
  "doorway into the entrance hall, then continuing forward from room to " +
  "room in the exact order the reference images are given, at an " +
  "unhurried, gentle pace, lingering briefly in each space. " +
  "Camera push in, dolly forward, walk forward, approach, advance, enter. " +
  "The camera NEVER does any of the following: it never moves backward, " +
  "it never dollies out or zooms out, it never pulls away from the " +
  "building, it never shows the facade becoming smaller or further away " +
  "at any point after frame one, it never reverses direction, and it " +
  "never revisits a view it has already passed through. Motion is " +
  "forward and only forward, continuously, from the first frame to the " +
  "last. Smooth, slow, deliberate, professional real estate videography, " +
  "photorealistic, level horizon, no distortion.";

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

function buildBody({ used, duration, keyframeIndexes, aspectRatio, withConcepts }) {
  const body = {
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
  };
  if (withConcepts) {
    body.concepts = [{ key: "push_in" }];
  }
  return body;
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

  const callLuma = (withConcepts) =>
    fetch(LUMA_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(
        buildBody({ used, duration, keyframeIndexes, aspectRatio, withConcepts })
      ),
    });

  try {
    let lumaRes = await callLuma(true);
    let data = await lumaRes.json();

    // Luma's "concepts" (structured camera-motion presets) feature isn't
    // documented as supported alongside multi-keyframe requests - if
    // sending it causes a 4xx rejection, retry once without it rather than
    // failing the whole generation over an optional hint.
    if (!lumaRes.ok && lumaRes.status >= 400 && lumaRes.status < 500) {
      lumaRes = await callLuma(false);
      data = await lumaRes.json();
    }

    if (!lumaRes.ok) {
      res.status(lumaRes.status).json({ error: `Luma-fejl: ${JSON.stringify(data)}` });
      return;
    }

    res.status(200).json({ id: data.id, state: data.state, keyframeCount: used.length });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke starte indgangsklippet: ${err.message}` });
  }
}
