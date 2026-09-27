// Shared helpers for talking to fal.ai's queue API.
//
// Why fal rather than a model vendor directly: one key and one request shape for every model,
// so swapping model is an environment variable rather than a rewrite. The model is therefore
// NOT hard-coded below - see FAL_MODEL.

// Kling v2.6 Pro, image-to-video. Chosen for this job because:
//  - it holds very close to the supplied photo, which is the whole requirement here;
//  - 1080p out;
//  - with audio off it is the cheapest credible 1080p option at ~$0.07/s, so a 5s clip is
//    ~$0.35 and a whole property (8 rooms) lands near $2.80. Seedance 2.0 looks better on
//    paper but costs $0.68/s at 1080p - about $27 for the same property, which does not fit
//    a per-video price anywhere near the market's $9-15.
// Override with the FAL_MODEL env var to try another model without touching code.
export const FAL_MODEL = process.env.FAL_MODEL || "fal-ai/kling-video/v2.6/pro/image-to-video";

// fal hands back absolute status/response URLs when a job is submitted, and the client sends
// them back here to poll. Fetching a client-supplied URL with our API key attached would be an
// open door (server-side request forgery), so every URL is checked against this allowlist
// before it is ever requested.
const ALLOWED_HOSTS = ["queue.fal.run", "fal.run", "rest.alpha.fal.ai"];

export function assertFalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw new Error("Ugyldig URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("Kun https er tilladt.");
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) throw new Error("URL'en peger ikke på fal.ai.");
  return parsed.toString();
}

export function falKeyOrRespond(res) {
  const key = process.env.FAL_KEY;
  if (!key) {
    res.status(500).json({
      error:
        "Serveren mangler en fal.ai-nøgle. Tilføj FAL_KEY under Vercel → Settings → " +
        "Environment Variables, og deploy igen.",
    });
    return null;
  }
  return key;
}

export function falHeaders(key) {
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}
