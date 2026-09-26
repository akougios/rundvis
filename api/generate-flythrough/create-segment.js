// Serverless function (Vercel) — starts ONE Luma Ray video generation segment:
// a plain image-to-image interpolation between two still photos.
//
// Earlier versions tried to chain segments by referencing the previous
// generation as the next segment's start_frame (to simulate one continuous
// camera move). Luma's current API rejects that combination:
// "generation-ref keyframes are only supported for video extend (a single
// start_frame OR end_frame generation reference); interpolate-from-generation
// is not yet available." So each segment is generated independently from two
// image URLs, and the browser plays the resulting clips back-to-back
// (with a short crossfade — see the flythrough player in index.html).
//
// To make the *sequence* feel like one deliberate walkthrough rather than a
// random shuffle of clips, the prompt is tailored by the segment's position:
// the first segment assumes image #1 is an exterior shot and describes
// walking up to and through the front door; later segments describe moving
// from the current room into the next one. This only works well if the
// photos are uploaded in the intended walking order (exterior first, then
// entryway, then room by room) — the app doesn't otherwise know the floor
// plan, and deliberately has no per-image prompt field for the user to fill in.
//
// NOTE: Luma retired the legacy api.lumalabs.ai/dream-machine/v1 API in
// favor of the new Agents API (agents.lumalabs.ai/v1). New API keys
// (the "luma-api-..." keys issued from platform.lumalabs.ai) only work
// against the new API.

const LUMA_BASE = "https://agents.lumalabs.ai/v1/generations";

const BASE_STYLE =
  "Cinematic professional real-estate listing footage, shot like a drone or steadicam, " +
  "wide field of view, slow and deliberate motion, gentle parallax, level horizon, " +
  "constant eye/drone height, no jump cuts, no shaking, no zooming in place, no rotating on the spot — continuous forward glide only.";

function promptForSegment(index, total) {
  if (index === 0) {
    return (
      "Real estate walkthrough video. The camera starts outside the building, facing its exterior facade and front entrance, " +
      "then glides smoothly and steadily forward, approaching and passing through the front door into the home's entryway. " +
      BASE_STYLE
    );
  }
  if (index === total - 1) {
    return (
      "Real estate walkthrough video, continuing steadily forward out of the previous room and into this final room, " +
      "moving deeper into the space to reveal its key features before settling. " +
      BASE_STYLE
    );
  }
  return (
    "Real estate walkthrough video, continuing a steady forward glide out of the previous room, through a doorway or opening, " +
    "and into the next room, revealing new interior details as it advances. " +
    BASE_STYLE
  );
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

  const { startImageUrl, endImageUrl, aspectRatio, segmentIndex, totalSegments } = req.body || {};

  if (!startImageUrl || !endImageUrl) {
    res.status(400).json({ error: "Mangler startImageUrl og/eller endImageUrl." });
    return;
  }

  const index = Number.isInteger(segmentIndex) ? segmentIndex : 0;
  const total = Number.isInteger(totalSegments) && totalSegments > 0 ? totalSegments : 1;

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
        prompt: promptForSegment(index, total),
        aspect_ratio: aspectRatio || "9:16",
        video: {
          resolution: "720p",
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
