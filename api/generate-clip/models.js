// Serverless function (Vercel) — lists the video models the app can use, so the picker in the
// browser is driven by the server's registry rather than a second hard-coded copy that would
// drift out of sync with it.
//
// Nothing secret is exposed: only labels, prices and durations. The endpoints and the API key
// stay on the server.

import { MODELS, DEFAULT_MODEL } from "../_fal.js";

export default function handler(req, res) {
  res.status(200).json({
    defaultModel: DEFAULT_MODEL,
    configured: Boolean(process.env.FAL_KEY),
    models: Object.entries(MODELS).map(([key, m]) => ({
      key,
      label: m.label,
      note: m.note,
      seconds: m.seconds,
      usdPerClip: Number((m.usdPerSecond * m.seconds).toFixed(3)),
      deterministic: m.deterministic,
    })),
  });
}
