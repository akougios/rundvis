// Serverless function (Vercel) — starts one clip for one room photo.

import { LUMA_BASE, buildRequest, lumaKeyOrRespond, explainStatus } from "../_luma.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const key = lumaKeyOrRespond(res);
  if (!key) return;

  const { imageUrl, motion, aspectRatio, quality, dir } = req.body || {};
  if (!imageUrl || typeof imageUrl !== "string" || !/^https:\/\//.test(imageUrl)) {
    res.status(400).json({ error: "Mangler et gyldigt billede-URL (https)." });
    return;
  }

  try {
    // The camera move is sent twice over: as a structured concept, which Luma follows most
    // literally, and in the prompt. If the concept key is rejected the request goes again on the
    // prompt alone - the move still comes out roughly right, and a clip that is slightly off
    // beats a clip that does not exist. Directional keys like pan_right cannot be verified
    // against Luma's vocabulary from here, so this is what keeps a wrong guess from costing the
    // agent their whole property.
    const withConcepts = JSON.stringify(buildRequest({ imageUrl, motion, aspectRatio, quality, dir }));
    const withoutConcepts = JSON.stringify(
      buildRequest({ imageUrl, motion, aspectRatio, quality, dir, withConcepts: false })
    );
    let body = withConcepts;
    let droppedConcepts = false;

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
      // 422 is Luma refusing a field. The concept key is the only guessed field in the request,
      // so drop it and try once more before calling this a failure.
      if (r.status === 422 && !droppedConcepts) {
        droppedConcepts = true;
        body = withoutConcepts;
        continue;
      }
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
      // ACCOUNT STATE SPEAKS DANISH FIRST. For an empty credit balance or a rejected key, the
      // person reading the screen has to DO something, and the thing to do is not in Luma's
      // English one-liner. "Not enough credits to continue" went to the screen exactly like that,
      // because our own wording was only used when the body was empty. Luma's text is kept in
      // brackets - it is still the authority on what happened.
      const accountState = r.status === 402 || r.status === 401 || r.status === 403;
      const message = accountState
        ? `Luma: ${explainStatus(r.status)}${detail ? ` (${detail})` : ""}`
        : `Luma afviste kaldet (HTTP ${r.status}): ${detail}`;
      res.status(r.status).json({
        error: message,
        // The page waits this one out rather than reporting it: see the comment on the retry loop.
        retryable: r.status === 429,
        // No amount of waiting buys credit or fixes a key, and every remaining room would fail
        // the same way. The page stops the run rather than spending the queue on it.
        fatal: accountState,
        retryAfter: Number.isFinite(after) && after > 0 ? after : null,
      });
      return;
    }

    res.status(200).json({ id: data.id });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke starte klippet: ${err.message}` });
  }
}
