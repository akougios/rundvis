// Serverless function (Vercel) — starts ONE Luma Ray video generation segment.
// Called repeatedly by the browser to build a chained "flythrough": each
// new segment continues the camera motion from the end of the previous
// generation (video.start_frame = {generation_id: prevId}) toward the next
// still image (video.end_frame = {url: endImageUrl}). The very first
// segment in a chain has no previous generation, so it starts from a
// static image instead (video.start_frame = {url: startImageUrl}).
//
// Luma generations are asynchronous — this returns immediately with an id
// and a "queued"/"processing" state. The browser polls /status for completion.
//
// NOTE: Luma retired the legacy api.lumalabs.ai/dream-machine/v1 API in
// favor of the new Agents API (agents.lumalabs.ai/v1). New API keys
// (the "luma-api-..." keys issued from platform.lumalabs.ai) only work
// against the new API — that's what caused the "Not authenticated" errors
// when this was still pointed at the old endpoint.

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

  const { startImageUrl, endImageUrl, prevGenerationId, aspectRatio } = req.body || {};

  if (!endImageUrl) {
    res.status(400).json({ error: "Mangler endImageUrl (billedet klippet skal bevæge sig hen imod)." });
    return;
  }
  if (!prevGenerationId && !startImageUrl) {
    res.status(400).json({ error: "Mangler enten startImageUrl (første klip i kæden) eller prevGenerationId (efterfølgende klip)." });
    return;
  }

  const startFrame = prevGenerationId
    ? { generation_id: prevGenerationId }
    : { url: startImageUrl };

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
        prompt: "Smooth, slow cinematic camera glide through a real estate interior, professional real-estate walkthrough style, stable and steady motion, no jump cuts.",
        aspect_ratio: aspectRatio || "9:16",
        video: {
          resolution: "720p",
          duration: "5s",
          start_frame: startFrame,
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
