// Exchanges the shared access code for a signed, expiring token. See _access.js for why the
// product is gated this way, and for how long this arrangement is meant to last.

import { issueAccessToken } from "./_access.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }
  const expected = process.env.ACCESS_CODE;
  if (!expected) {
    // No code configured: say so plainly rather than handing out tokens that guard nothing.
    res.status(200).json({ token: "", open: true });
    return;
  }
  const given = (req.body && req.body.code) || "";
  // Constant-time compare on the code too. It is short and human-chosen, which is exactly the
  // kind an attacker would try to find one character at a time.
  let diff = given.length === expected.length ? 0 : 1;
  for (let i = 0; i < Math.max(given.length, expected.length); i++) {
    diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  if (diff !== 0) {
    res.status(401).json({ error: "Forkert adgangskode." });
    return;
  }
  const token = await issueAccessToken();
  if (!token) {
    res.status(500).json({ error: "Serveren kan ikke signere adgangen. Sæt ACCESS_TOKEN_SECRET." });
    return;
  }
  res.status(200).json({ token });
}
