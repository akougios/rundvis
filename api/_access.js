// WHO IS ALLOWED TO SPEND OUR MONEY.
//
// Four endpoints call a paid third party: Luma, Anthropic, ElevenLabs and Vercel Blob. Until
// this file they were open to the whole internet - anyone with the address could run up our
// bill, and the Luma balance that ran out mid-run on 10 October could as easily have been
// someone else's doing.
//
// This is NOT login. It is one shared code for the whole product, which is the right size for
// where we are: no customers, a handful of named agents being shown a demo. It goes away when
// real accounts land, and the signing below is the part that stays.
//
// Why a token rather than sending the code on every call: the code then travels once, over TLS,
// instead of sitting in every request where a screenshot or a shared HAR file would carry it.
// The token expires on its own, so a leaked one stops working.

// Thirty days, not twelve hours. The two of us are the only users, we test daily, and being
// asked for the code twice a day is the kind of friction that ends with the gate turned off
// altogether - which is the outcome this exists to prevent. The trade is that a leaked token
// stays good for a month; at this stage, with no customer data behind it, that is the right way
// round. Shorten it the day real accounts arrive.
const TOKEN_HOURS = 24 * 30;

function accessSecret() {
  // Signed with its own secret where one is set, otherwise with the key that already guards the
  // video proxy. Never with the access code itself: a secret that the user types is a weak one.
  return process.env.ACCESS_TOKEN_SECRET || process.env.VIDEO_PROXY_SECRET || process.env.LUMA_API_KEY || "";
}

async function sign(payload) {
  const secret = accessSecret();
  if (!secret) return "";
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, enc.encode(payload));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A token is "<expires-at-ms>.<signature over that number>". Nothing secret is inside it; the
// signature is what makes it unforgeable, and the timestamp is in the clear so the browser can
// see when to ask for the code again without a round trip.
export async function issueAccessToken() {
  const expires = Date.now() + TOKEN_HOURS * 3600 * 1000;
  const sig = await sign(String(expires));
  return sig ? `${expires}.${sig}` : "";
}

export async function tokenIsValid(token) {
  if (typeof token !== "string" || token.indexOf(".") < 1) return false;
  const [expires, sig] = token.split(".", 2);
  const ms = Number(expires);
  if (!Number.isFinite(ms) || ms < Date.now()) return false;
  const expected = await sign(expires);
  if (!expected || expected.length !== sig.length) return false;
  // Constant-time compare, so a signature cannot be discovered one character at a time.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// Put this at the top of every endpoint that costs money. Returns true when the caller may
// proceed; when it returns false it has already answered the request.
//
// With no ACCESS_CODE set the gate is OPEN, and that is deliberate: a missing variable must not
// take a working deployment down. It is reported in the response header so a misconfiguration is
// visible rather than silent.
export async function allowedToSpend(req, res) {
  if (!process.env.ACCESS_CODE) {
    res.setHeader("x-rundvis-gate", "open-no-code-set");
    return true;
  }
  const header = req.headers["x-rundvis-access"];
  const token = Array.isArray(header) ? header[0] : header;
  if (await tokenIsValid(token)) return true;
  res.status(401).json({ error: "Adgangskoden mangler eller er udløbet.", needsAccess: true });
  return false;
}
