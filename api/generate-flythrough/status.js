// Serverless function (Vercel) — polls the status of one Luma generation.
// The browser calls this every few seconds until state is "completed"
// (returns the finished clip's video URL) or "failed".

const LUMA_BASE = "https://api.lumalabs.ai/dream-machine/v1/generations";

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

    res.status(200).json({
      state: data.state, // "queued" | "dreaming" | "completed" | "failed"
      videoUrl: data.assets?.video || null,
      failureReason: data.failure_reason || null,
    });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke hente status: ${err.message}` });
  }
}
