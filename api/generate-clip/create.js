// Serverless function (Vercel) — starts one clip for one room photo.

import { LUMA_BASE, buildRequest, lumaKeyOrRespond, explainStatus } from "../_luma.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const key = lumaKeyOrRespond(res);
  if (!key) return;

  const { imageUrl, motion, aspectRatio, quality } = req.body || {};
  if (!imageUrl || typeof imageUrl !== "string" || !/^https:\/\//.test(imageUrl)) {
    res.status(400).json({ error: "Mangler et gyldigt billede-URL (https)." });
    return;
  }

  try {
    const body = JSON.stringify(buildRequest({ imageUrl, motion, aspectRatio, quality }));

    // Several clips are submitted at once so a whole property finishes in minutes rather than
    // half an hour, and a burst is exactly what gets rate-limited. A 429 is therefore an expected
    // part of normal operation here, not something to hand the agent.
    //
    // Only a couple of quick retries happen here. This function runs under a serverless time
    // limit measured in seconds, so it cannot sit and wait out a limit on *concurrent*
    // generations - that kind of 429 persists until an earlier clip finishes, minutes later.
    // Waiting that long is the browser's job, so a persistent 429 is handed back marked
    // retryable and the page keeps trying (see runHighQuality in public/index.html).
    let r, text;
    for (let attempt = 0; ; attempt++) {
      r = await fetch(LUMA_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body,
      });
      text = await r.text();
      if (r.status !== 429 || attempt >= 1) break;
      const after = Number(r.headers.get("retry-after"));
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 1500;
      await new Promise((done) => setTimeout(done, Math.min(wait, 3000)));
    }

    let data;
    try { data = JSON.parse(text); } catch (e) { data = null; }

    if (!r.ok) {
      // The status code is always included: an error with an empty body would otherwise produce
      // an empty message.
      const raw = (data && (data.detail || data.error || data.message)) ?? null;
      const detail = raw == null || raw === ""
        ? (text.slice(0, 300) || explainStatus(r.status))
        : (typeof raw === "string" ? raw : JSON.stringify(raw).slice(0, 300));
      const after = Number(r.headers.get("retry-after"));
      res.status(r.status).json({
        error: `Luma afviste kaldet (HTTP ${r.status}): ${detail}`,
        // The page waits this one out rather than reporting it: see the comment on the retry loop.
        retryable: r.status === 429,
        retryAfter: Number.isFinite(after) && after > 0 ? after : null,
      });
      return;
    }

    res.status(200).json({ id: data.id });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke starte klippet: ${err.message}` });
  }
}
