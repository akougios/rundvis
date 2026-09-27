// Shared helpers for talking to fal.ai's queue API, plus the registry of video models the app
// can use.
//
// Why fal rather than a model vendor directly: one key and one queue protocol for every model,
// so trying another model is a config change rather than a new integration.

// ---- Model registry ------------------------------------------------------------------------
// Each entry adapts our request onto that model's own input schema - they genuinely differ
// (Kling wants `start_image_url` and a duration of "5", Seedance wants `image_url` and the
// number 3, Luma wants `image_url` and "5s"). Prices are fal's published rates at the time of
// writing and are shown in the UI only as an estimate; treat the invoice as the truth.
//
// There is deliberately no single "best" here. The three differ in ways that only matter once
// you look at real listing photos, which is why the app can generate a single test clip on any
// of them rather than committing to a whole property.
export const MODELS = {
  "kling-2.6-pro": {
    label: "Kling 2.6 Pro",
    endpoint: "fal-ai/kling-video/v2.6/pro/image-to-video",
    // Strong at holding the supplied frame. Cheapest credible 1080p option. No seed, so a
    // regenerated clip will not be identical.
    note: "God troskab mod fotoet, billigst i 1080p. Ingen seed, så to kørsler er ikke ens.",
    seconds: 5,          // shortest this model offers
    usdPerSecond: 0.07,  // with audio off
    deterministic: false,
    build: ({ imageUrl, prompt, negativePrompt }) => ({
      prompt,
      start_image_url: imageUrl,
      duration: "5",
      negative_prompt: negativePrompt,
      // Audio would be invented speech or ambience we do not want, and it roughly doubles the
      // price per second.
      generate_audio: false,
    }),
  },

  "seedance-1-pro": {
    label: "Seedance 1.0 Pro",
    endpoint: "fal-ai/bytedance/seedance/v1/pro/image-to-video",
    // The only one of the three with a SEED, which matters for this product: the app promises
    // that the same photos give the same video. It also takes an exact duration, so we can buy
    // the 3 seconds the edit actually uses instead of a 5-second minimum.
    note: "Har seed (samme input giver samme klip) og frit valg af længde, så vi kun betaler for de sekunder klipningen bruger.",
    seconds: 3,
    usdPerSecond: 0.124,
    deterministic: true,
    build: ({ imageUrl, prompt, aspectRatio, seed }) => ({
      prompt,
      image_url: imageUrl,
      duration: 3,
      resolution: "1080p",
      aspect_ratio: aspectRatio || "auto",
      camera_fixed: false,
      seed,
    }),
  },

  "luma-ray2": {
    label: "Luma Ray 2",
    endpoint: "fal-ai/luma-dream-machine/ray-2/image-to-video",
    // Luma's camera language (dolly, orbit, crane) is the most "directed" of the three, which is
    // exactly the vocabulary a property film uses - and it is by far the cheapest per second.
    // NOTE: the earlier Luma problems in this repo were with DUAL-image interpolation, a much
    // harder task. Single-image motion is a different mode and is not covered by that history.
    note: "Mest filmisk kamerasprog (dolly, orbit, crane) og billigst pr. sekund. Bemærk: de gamle Luma-problemer her i repoet var med to-billed-interpolation, ikke denne tilstand.",
    seconds: 5,
    usdPerSecond: 0.04,
    deterministic: false,
    build: ({ imageUrl, prompt, aspectRatio }) => ({
      prompt,
      image_url: imageUrl,
      duration: "5s",
      resolution: "1080p",
      aspect_ratio: aspectRatio && aspectRatio !== "auto" ? aspectRatio : "16:9",
    }),
  },
};

export const DEFAULT_MODEL = process.env.FAL_MODEL_KEY || "kling-2.6-pro";

export function resolveModel(key) {
  const k = key && MODELS[key] ? key : DEFAULT_MODEL;
  return { key: k, ...MODELS[k] };
}

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
