// Talking to Luma's API.
//
// One model, on purpose. Four were compared side by side on real listing photos; Luma Ray 3.2
// held the rooms best, so the rest were removed rather than left as options. A picker between
// models the agent has no way to judge is not a feature - it is a decision pushed onto them.
// (The comparison harness is in git history if another model ever needs evaluating.)

export const LUMA_BASE = "https://agents.lumalabs.ai/v1/generations";

// Luma's structured camera moves. These are far more literal than describing motion in prose,
// and they are what Luma is strongest at.
//
// Direction is carried through rather than dropped. Every clip used to go out as pan_left or
// push_in, so a property upgraded to real camera motion came back LESS varied than the free 2D
// version it replaced - eighteen rooms all drifting the same way. The edit already alternates
// direction shot by shot; this is what lets the generated clips honour it.
const CONCEPTS = {
  push: () => "push_in",
  lean: () => "push_in",
  pull: () => "pull_out",
  pullback: () => "pull_out",
  pan: (dir) => (dir < 0 ? "pan_right" : "pan_left"),
  drift: () => "crane_up",
  orbit: (dir) => (dir < 0 ? "orbit_right" : "orbit_left"),
};

// Two quality steps. Test exists so a room can be checked for a fraction of the price: if the
// model warps something at 720p it will warp it at 1080p too.
export const QUALITIES = {
  test: { resolution: "720p", usdPerClip: 0.45, label: "Test" },
  final: { resolution: "1080p", usdPerClip: 0.95, label: "Fuld kvalitet" },
};

const CLIP_SECONDS = "5s";

// Says what the CAMERA does, and states plainly that the room must not change. These models will
// happily redecorate a room, and for a listing video that is worse than no motion at all: the
// video has to show the property that is actually for sale.
const BASE_PROMPT =
  "Real estate listing video of this exact room. Photorealistic, filmed on a gimbal. " +
  "The room, the furniture, the light and the view through the windows all stay exactly as " +
  "they are in the photo: nothing moves, nothing changes shape, nothing is added or removed. " +
  "No people, no animals, no text. Only the camera moves.";

// The prompt says the move in words as well, and carries the direction. It is not redundant with
// the concept: if a concept key is ever rejected the request is retried on the prompt alone, and
// the move still comes out roughly right rather than becoming a random drift.
const side = (dir) => (dir < 0 ? "right" : "left");
const MOTION = {
  push: () => "The camera moves slowly and steadily forward into the room.",
  lean: (dir) =>
    `The camera eases forward into the room and leans slightly to the ${side(dir)} as it goes.`,
  pull: () => "The camera moves slowly and steadily backwards, revealing more of the room.",
  pullback: () => "The camera moves slowly and steadily backwards, revealing more of the room.",
  pan: (dir) =>
    `The camera tracks slowly and steadily sideways to the ${side(dir)} across the room, staying level.`,
  drift: () => "The camera rises slowly and steadily, craning up over the room.",
  orbit: (dir) =>
    `The camera arcs slowly and steadily around the room to the ${side(dir)}, staying level, ` +
    "as if walking around the space.",
};

export function buildRequest({ imageUrl, motion, aspectRatio, quality, dir, withConcepts = true }) {
  const q = QUALITIES[quality] || QUALITIES.test;
  const d = dir === -1 ? -1 : 1;
  const words = (MOTION[motion] || MOTION.push)(d);
  const body = {
    model: "ray-3.2",
    type: "video",
    prompt: `${BASE_PROMPT} ${words}`,
    aspect_ratio: aspectRatio && aspectRatio !== "auto" ? aspectRatio : "16:9",
    video: {
      resolution: q.resolution,
      duration: CLIP_SECONDS,
      // Luma requires keyframes and keyframe_indexes together or not at all. One image pinned to
      // frame 0 is the point: the photo is where the clip starts, and the rest is the move.
      keyframes: [{ url: imageUrl }],
      keyframe_indexes: [0],
    },
  };
  if (withConcepts) body.concepts = [{ key: (CONCEPTS[motion] || CONCEPTS.push)(d) }];
  return body;
}

export function lumaKeyOrRespond(res) {
  const key = process.env.LUMA_API_KEY;
  if (!key) {
    res.status(500).json({
      error: "Serveren mangler LUMA_API_KEY. Sæt den under Vercel → Settings → Environment Variables.",
    });
    return null;
  }
  return key;
}

// A plain-language reading of the status codes, for when the body is empty and the number is all
// there is. An earlier version passed through only the body, so a 401 or 402 - which typically
// have no body at all - produced a blank message and hid the one fact needed to fix it.
export function explainStatus(status) {
  if (status === 401 || status === 403) return "nøglen blev afvist — tjek LUMA_API_KEY.";
  if (status === 402) return "der er ikke kredit nok på Luma-kontoen.";
  if (status === 404) return "modellen findes ikke på den adresse.";
  if (status === 422) return "et af felterne blev afvist af modellen.";
  if (status === 429) return "for mange kald på for kort tid.";
  if (status >= 500) return "Luma har en driftsforstyrrelse — prøv igen om lidt.";
  return "intet svar at vise.";
}

// The proxy must be able to prove a video URL came from us, so it is signed when handed out.
// Allowlisting hostnames was the earlier approach and was worse: a CDN host has to be guessed,
// and guessing wide enough to work meant allowing every S3 bucket in existence.
function proxySecret() {
  return process.env.VIDEO_PROXY_SECRET || process.env.LUMA_API_KEY || "";
}

export async function signVideoUrl(url) {
  const secret = proxySecret();
  if (!secret) return "";
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, enc.encode(url));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyVideoUrl(url, sig) {
  if (!sig) return false;
  const expected = await signVideoUrl(url);
  if (!expected || expected.length !== sig.length) return false;
  // Constant-time compare, so the signature cannot be discovered one character at a time.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
