// Serverless function (Vercel) — starts ONE short Luma Ray AI video clip for
// the "arrival": the camera moves from the exterior facade photo, forward
// and through the front door, into the first interior photo.
//
// This is deliberately NOT a full room-by-room AI-generated flythrough
// anymore. Real estate walkthrough videos aren't actually one continuous
// AI-planned flight through every room - they're a short, real "coming
// through the door" moment, followed by an edited montage of the
// individual room photos with pan/zoom. Luma has no concept of a floor
// plan or room order beyond "these images, in this order" - asking it to
// navigate many rooms in one AI call was exactly what caused it to
// sometimes invent backward motion or disjointed cuts. Limiting it to a
// single, well-defined transition (facade -> entry) is a task it can
// actually do more reliably. The remaining room photos are rendered as a
// Ken-Burns pan/zoom montage entirely client-side (see public/index.html) -
// no AI involved there, so there's no risk of AI artifacts in those shots,
// and no per-room Luma cost.
//
// IMPORTANT: uses Luma's multi-keyframe mode (video.keyframes +
// video.keyframe_indexes) rather than the simpler 2-point interpolation
// mode (video.start_frame / video.end_frame). Both were tried for this
// exact "exterior -> through the door" transition; only multi-keyframe
// mode reliably avoided the camera moving backward / pulling away from
// the building before entering (a bug that came back every time this was
// switched to start_frame/end_frame, across several different prompt
// wordings). Kept even though there are only 2 keyframes here, because
// this specific combination is the one that has actually worked.
//
// NOTE: Luma retired the legacy api.lumalabs.ai/dream-machine/v1 API in
// favor of the new Agents API (agents.lumalabs.ai/v1). New API keys (the
// "luma-api-..." keys issued from platform.lumalabs.ai) only work against
// the new API.

const LUMA_BASE = "https://agents.lumalabs.ai/v1/generations";
const FPS = 24;
const ENTRY_DURATION_S = 5;

// "camera push in" is one of Luma's own documented trigger phrases for
// forward camera motion (Dream Machine's camera control is entirely
// language-based, and specific phrases like this are followed more
// reliably than descriptive prose). Combined with the calm/slow language
// from the version that was confirmed to look good.
const ENTRY_PROMPT =
  "Camera push in, dolly forward, slow and steady. " +
  "The camera moves straight forward, advancing from outside the " +
  "building toward the front door and continuing forward through the " +
  "doorway into the entryway, at an unhurried, gentle pace. Push in the " +
  "entire time - the camera never pulls back, never dollies out, never " +
  "zooms out, never reveals the building from further away, and never " +
  "retreats. Forward motion only, from start to finish. Smooth, slow, " +
  "deliberate, professional real estate videography, photorealistic, " +
  "level horizon, no distortion.";

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

  const [exteriorUrl, entryUrl] = imageUrls;
  const maxFrame = ENTRY_DURATION_S * FPS;

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
          duration: `${ENTRY_DURATION_S}s`,
          keyframes: [{ url: exteriorUrl }, { url: entryUrl }],
          keyframe_indexes: [0, maxFrame],
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
    res.status(500).json({ error: `Kunne ikke starte indgangsklippet: ${err.message}` });
  }
}
