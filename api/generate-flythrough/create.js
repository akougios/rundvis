// Serverless function (Vercel) — starts ONE Luma Ray multi-keyframe video
// generation that covers the ENTIRE walkthrough in a single call, instead of
// chaining/stitching several independent 2-image clips together.
//
// Why: Luma's Agents API (ray-3.2) supports up to 64 keyframes in one
// generation (video.keyframes + video.keyframe_indexes), as an alternative
// to the simpler start_frame/end_frame (2-point) mode. Giving Luma the
// whole ordered sequence of photos at once lets it plan ONE continuous,
// forward-moving camera path across all of them - it can "see" the full
// route (exterior -> door -> room -> room -> ...) instead of only ever
// seeing two isolated frames per call with no idea what comes before or
// after. That directly fixes the two problems reported when this was built
// as independent chained segments: (1) individual clips sometimes moving
// backward / away from the building rather than forward through it, and
// (2) the stitched-together clips feeling disjointed, with mismatched
// motion at the cut points.
//
// video.keyframes / video.keyframe_indexes are mutually exclusive with
// start_frame / end_frame / loop. keyframe_indexes are frame positions on a
// duration x 24fps grid (5s -> 0-120, 10s -> 0-240); both 5s and 10s
// durations are supported in this mode (unlike 2-point mode, which is
// 5s-only). We use 10s whenever there are more than 2 photos, so later
// rooms still get a meaningful amount of screen time; with exactly 2
// photos (a single exterior -> interior transition) 5s is enough.
//
// NOTE: Luma retired the legacy api.lumalabs.ai/dream-machine/v1 API in
// favor of the new Agents API (agents.lumalabs.ai/v1). New API keys (the
// "luma-api-..." keys issued from platform.lumalabs.ai) only work against
// the new API.

const LUMA_BASE = "https://agents.lumalabs.ai/v1/generations";
const FPS = 24;

// Single, position-agnostic prompt: Luma sees every photo at once (in
// order), so one instruction describing the whole route works better than
// per-segment prompts that had no knowledge of each other. The language
// leans hard on "forward only" / "never backward" because that was the
// concrete bug reported: a clip that visibly moved backward through the
// front door, briefly showing the house itself out in the garden before
// entering, instead of a clean forward approach.
const FLYTHROUGH_PROMPT =
  "Smooth, continuous real-estate walkthrough video shot from a single " +
  "moving camera, like a slow, calm steadicam gliding forward through the " +
  "property at an unhurried, deliberate pace - not a fast drone flythrough. " +
  "The camera always moves forward, in the same direction the images are " +
  "ordered: it starts outside showing the building's facade, advances " +
  "slowly toward and through the front door, then continues forward from " +
  "room to room in the exact sequence of the provided photos, pausing " +
  "briefly and lingering in each space rather than rushing through it. " +
  "The camera never moves backward, never retreats away from the " +
  "building, never reverses direction, and never revisits a room or view " +
  "it has already passed through. Gentle, slow, natural walking-pace " +
  "speed, level horizon, realistic architecture and lighting, no warped " +
  "walls or floating objects, photorealistic quality suitable for a " +
  "professional real estate listing.";

function buildKeyframeIndexes(count, maxFrame) {
  // Evenly spread `count` keyframes across [0, maxFrame], first at 0 and
  // last at maxFrame, then round to integers and nudge forward on any
  // collision so indexes stay strictly increasing (Luma requires that).
  const raw = Array.from({ length: count }, (_, i) =>
    count === 1 ? 0 : Math.round((i * maxFrame) / (count - 1))
  );
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] <= raw[i - 1]) raw[i] = raw[i - 1] + 1;
  }
  if (raw[raw.length - 1] > maxFrame) {
    // Extremely unlikely (only if count > maxFrame+1), but guard anyway.
    raw[raw.length - 1] = maxFrame;
  }
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
    res.status(400).json({ error: "Mangler mindst 2 billed-URL'er (imageUrls)." });
    return;
  }
  if (imageUrls.length > 64) {
    res.status(400).json({ error: "Luma understøtter højst 64 billeder i én gennemgang." });
    return;
  }

  const duration = imageUrls.length > 2 ? "10s" : "5s";
  const maxFrame = duration === "10s" ? 10 * FPS : 5 * FPS;
  const keyframeIndexes = buildKeyframeIndexes(imageUrls.length, maxFrame);

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
        prompt: FLYTHROUGH_PROMPT,
        aspect_ratio: aspectRatio || "9:16",
        video: {
          resolution: "720p",
          duration,
          keyframes: imageUrls.map((url) => ({ url })),
          keyframe_indexes: keyframeIndexes,
        },
      }),
    });

    const data = await lumaRes.json();
    if (!lumaRes.ok) {
      res.status(lumaRes.status).json({ error: `Luma-fejl: ${JSON.stringify(data)}` });
      return;
    }

    res.status(200).json({ id: data.id, state: data.state });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke starte gennemgangen: ${err.message}` });
  }
}
