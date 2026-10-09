// Talking to Google's Veo, for comparison against Luma.
//
// This exists to answer one question with a real clip rather than a price page: on the same
// photograph, with the same words, does Veo hold a room better than Ray 3.2 does - and what does
// it actually cost. Both halves matter. Veo bills per second where Luma bills per clip, and our
// shots are on screen for under three seconds, so the saving is in buying four seconds instead of
// five rather than in the rate itself.
//
// The prompt comes from _luma.js on purpose. Two models given two different prompts is not a
// comparison of models.
import { promptFor, signVideoUrl } from "./_luma.js";

export const VEO_BASE = "https://generativelanguage.googleapis.com/v1beta";

// The quality tier, not the Fast one. The question being asked is whether Veo's best beats what
// we have; if it does, Fast is the next question and a much cheaper one.
export const VEO_MODEL = "veo-3.1-generate-preview";

// Four seconds. Our longest shot holds for 4.66s and the median for 2.8s, so eight seconds would
// be paying for footage no one will ever see - which is exactly the waste this project already
// measured once on Luma's fixed five.
export const VEO_SECONDS = 4;
export const VEO_USD_PER_SECOND = 0.20;   // list price, video without audio

// Veo takes 16:9 and 9:16. There is no square, so a 1:1 preview is compared on the widescreen
// clip, cropped the same way a Luma clip would be.
function veoAspect(aspectRatio) {
  return aspectRatio === "9:16" ? "9:16" : "16:9";
}

// TWO SHAPES, TRIED IN ORDER, because the documentation and the live API disagree.
//
// Google's own Veo page shows the image as {"inlineData": {"mimeType", "data"}}, which is the
// shape the chat-style generateContent endpoint uses. Sent to predictLongRunning it comes back
// 400: "`inlineData` isn't supported by this model." The predict-style endpoints elsewhere in
// Vertex take {"bytesBase64Encoded", "mimeType"} instead, so that is tried first and the
// documented one kept as the fallback.
//
// Guessing which is right costs a deploy and a wait each time, and this environment cannot reach
// Google to find out. Trying both costs one request when the first is right, two when it is not,
// and the answer comes back in the response so it only has to be learned once.
export const VEO_IMAGE_SHAPES = ["bytesBase64Encoded", "inlineData"];

export function buildVeoRequest({ imageBase64, mimeType, motion, aspectRatio, dir, resolution, shape }) {
  const mt = mimeType || "image/jpeg";
  const image =
    shape === "inlineData"
      ? { inlineData: { mimeType: mt, data: imageBase64 } }
      : { bytesBase64Encoded: imageBase64, mimeType: mt };
  return {
    instances: [{ prompt: promptFor(motion, dir), image }],
    parameters: {
      aspectRatio: veoAspect(aspectRatio),
      resolution: resolution === "720p" ? "720p" : "1080p",
      durationSeconds: String(VEO_SECONDS),
    },
  };
}

export function veoKeyOrRespond(res) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(500).json({
      error: "Serveren mangler GEMINI_API_KEY. Sæt den under Vercel → Settings → Environment Variables.",
    });
    return null;
  }
  return key;
}

// Google answers a finished job with the clip behind a URL that only opens with the API key, so
// it cannot be handed to a <video> element directly. It is signed here and served through
// /api/proxy-video, the same path a Luma clip takes.
export async function veoVideoFrom(operation) {
  const samples =
    operation?.response?.generateVideoResponse?.generatedSamples ||
    operation?.response?.generatedSamples ||
    [];
  const url = samples[0]?.video?.uri || samples[0]?.uri || "";
  if (!url) return null;
  return { url, sig: await signVideoUrl(url) };
}

export function explainVeoStatus(status) {
  if (status === 400) return "kaldet blev afvist - ofte et billede der er for stort.";
  if (status === 401 || status === 403) return "nøglen blev afvist - tjek GEMINI_API_KEY.";
  if (status === 404) return "modellen findes ikke på den adresse.";
  if (status === 429) return "for mange kald på for kort tid.";
  if (status >= 500) return "Google har en driftsforstyrrelse - prøv igen om lidt.";
  return "intet svar at vise.";
}
