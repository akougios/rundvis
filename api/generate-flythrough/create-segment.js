// Serverless function (Vercel) — starts ONE Luma Ray-2 generation segment.
// Called repeatedly by the browser to build a chained "flythrough": each
// new segment continues the camera motion from the end of the previous
// generation (frame0 = {type:"generation", id: prevId}) toward the next
// still image (frame1 = {type:"image", url: endImageUrl}). The very first
// segment in a chain has no previous generation, so it starts from a
// static image instead (frame0 = {type:"image", url: startImageUrl}).
//
// Luma generations are asynchronous — this returns immediately with an id
// and a "queued"/"dreaming" state. The browser polls /status for completion.

const LUMA_BASE = "https://api.lumalabs.ai/dream-machine/v1/generations";

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

  const keyframes = {
    frame0: prevGenerationId
      ? { type: "generation", id: prevGenerationId }
      : { type: "image", url: startImageUrl },
    frame1: { type: "image", url: endImageUrl },
  };

  try {
    const lumaRes = await fetch(LUMA_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "ray-2",
        resolution: "720p",
        duration: "5s",
        aspect_ratio: aspectRatio || "9:16",
        keyframes,
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
