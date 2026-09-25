// Serverless function (Vercel) — polls the status of one Luma generation.
// The browser calls this every few seconds until state is "completed"
// (returns the finished clip's video URL) or "failed".
//
// Uses Luma's current Agents API (agents.lumalabs.ai/v1) — see the note in
// create-segment.js about the migration from the old dream-machine/v1 API.

const LUMA_BASE = "https://agents.lumalabs.ai/v1/generations";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Kun GET er tilladt." });
    return;
  }

  const apiKey = process.env.LUMA_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Serveren mangler en LUMA_API_KEY. Sæt den under Vercel → Settings → Environment Variables.",
    });
    return;
  }

  const { id } = req.query;
  if (!id) {
    res.status(400).json({ error: "Mangler id." });
    return;
  }

  try {
    const lumaRes = await fetch(`${LUMA_BASE}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await lumaRes.json();
    if (!lumaRes.ok) {
      res.status(lumaRes.status).json({ error: `Luma-fejl: ${JSON.stringify(data)}` });
      return;
    }

    // "processing" is the current in-flight state name (the old API used
    // "dreaming"); the browser only checks for "completed" / "failed", so
    // any other value just means "still working".
    const videoOutput = Array.isArray(data.output)
      ? data.output.find((o) => o.url) || data.output[0]
      : null;

    res.status(200).json({
      state: data.state,
      videoUrl: videoOutput?.url || null,
      failureReason: data.failure_reason || data.failure_code || null,
    });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke hente status: ${err.message}` });
  }
}
