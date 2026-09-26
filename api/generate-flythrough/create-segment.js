// Serverless function (Vercel) — starts ONE Luma Ray video generation segment:
// a plain image-to-image interpolation between two still photos.
//
// Earlier versions tried to chain segments by referencing the previous
// generation as the next segment's start_frame (to simulate one continuous
// camera move). Luma's current API rejects that combination:
// "generation-ref keyframes are only supported for video extend (a single
// start_frame OR end_frame generation reference); interpolate-from-generation
// is not yet available." So each segment is generated independently from two
// image URLs, and the browser plays the resulting clips back-to-back.
//
// Luma generations are asynchronous — this returns immediately with an id
// and a "queued"/"processing" state. The browser polls /status for completion.
//
// NOTE: Luma retired the legacy api.lumalabs.ai/dream-machine/v1 API in
// favor of the new Agents API (agents.lumalabs.ai/v1). New API keys
// (the "luma-api-..." keys issued from platform.lumalabs.ai) only work
// against the new API.

const LUMA_BASE = "https://agents.lumalabs.ai/v1/generations";

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

  const { startImageUrl, endImageUrl, aspectRatio } = req.body || {};

  if (!startImageUrl || !endImageUrl) {
    res.status(400).json({ error: "Mangler startImageUrl og/eller endImageUrl." });
    return;
  }

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
        prompt: "Real estate drone walkthrough video. The camera moves steadily forward, floating smoothly like a drone or steadicam through the interior of a home, gliding from one space toward the next as if continuing into the next room. Cinematic, professional real-estate listing footage, wide field of view, slow and deliberate forward motion, gentle parallax, no jump cuts, no shaking, no zoom-in-place — continuous glide only.",
        aspect_ratio: aspectRatio || "9:16",
        video: {
          resolution: "1080p",
          duration: "5s",
          start_frame: { url: startImageUrl },
          end_frame: { url: endImageUrl },
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
    res.status(500).json({ error: `Kunne ikke starte klip: ${err.message}` });
  }
}
