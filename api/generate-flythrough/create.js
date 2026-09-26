// Serverless function (Vercel) — starts ONE short Luma Ray AI video clip for
// the "arrival": the camera moves from the exterior facade photo, forward
// and through the front door, into the first interior photo.
//
// This is deliberately NOT a full room-by-room AI-generated flythrough
// anymore. Real estate walkthrough videos aren't actually one continuous
// AI-planned flight through every room - they're a short, real "coming
// through the door" moment, followed by an edited montage of the
// individual room photos with pan/zoom. Luma has no concept of a floor
// plan or room order beyond "these two images, in this order" - asking it
// to navigate many rooms in one AI call was exactly what caused it to
// sometimes invent backward motion or disjointed cuts. Limiting it to a
// single, well-defined 2-image transition (facade -> entry) is a task it
// can actually do reliably. The remaining room photos are rendered as a
// Ken-Burns pan/zoom montage entirely client-side (see public/index.html) -
// no AI involved there, so there's no risk of AI artifacts in those shots,
// and no per-room Luma cost.
//
// Uses the simple 2-point interpolation mode (video.start_frame /
// video.end_frame), which only supports 5s clips but is the most reliable,
// well-tested mode for a single clean transition between two photos.
//
// NOTE: Luma retired the legacy api.lumalabs.ai/dream-machine/v1 API in
// favor of the new Agents API (agents.lumalabs.ai/v1). New API keys (the
// "luma-api-..." keys issued from platform.lumalabs.ai) only work against
// the new API.

const LUMA_BASE = "https://agents.lumalabs.ai/v1/generations";

const ENTRY_PROMPT =
  "Cinematic real estate listing intro shot: a single smooth, slow, " +
  "deliberate camera movement starting outside showing the building's " +
  "facade, then gliding forward at an unhurried, elegant pace toward the " +
  "front door, moving through the doorway and arriving just inside the " +
  "entryway. The camera only ever moves forward, in a straight, " +
  "believable path - it never moves backward, never retreats away from " +
  "the building, and never reverses direction. Gentle, steady, level " +
  "horizon, photorealistic architecture and lighting, no warped walls or " +
  "floating objects, professional real estate videography quality.";

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
          duration: "5s",
          start_frame: { url: exteriorUrl },
          end_frame: { url: entryUrl },
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
