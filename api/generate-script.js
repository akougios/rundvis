// Serverless function (Vercel) — holds the Anthropic API key server-side.
// The browser never sees ANTHROPIC_API_KEY; it only calls this endpoint.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Serveren mangler en ANTHROPIC_API_KEY. Sæt den under Vercel → Settings → Environment Variables.",
    });
    return;
  }

  const { propertyTypeLabel, address, agentName, notes, sceneCount } = req.body || {};

  if (!propertyTypeLabel || !sceneCount || sceneCount < 1) {
    res.status(400).json({ error: "Manglende felter (propertyTypeLabel, sceneCount)." });
    return;
  }

  const prompt = `Du skriver korte, naturlige danske voiceover-linjer til en boligvideo for en ejendomsmægler.

Boligtype/formål: ${propertyTypeLabel}
Adresse: ${address || "(ikke angivet)"}
Mægler: ${agentName || "(ikke angivet)"}
Nøgledetaljer fra sælger/salgsopstilling: ${notes || "(ingen angivet)"}

Videoen har præcis ${sceneCount} scener, én pr. billede, i denne rækkefølge.

Skriv én kort voiceover-linje per scene (8-16 ord, talesprog, ingen klichéer gentaget). Linjerne skal tilsammen opbygge en naturlig fortælling og matche tonen for "${propertyTypeLabel}".

Svar KUN med et JSON-array af ${sceneCount} strenge, intet andet, ingen markdown-fences.`;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      res.status(anthropicRes.status).json({ error: `Anthropic API-fejl: ${errText}` });
      return;
    }

    const data = await anthropicRes.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    let raw = textBlock ? textBlock.text : "";
    raw = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

    let lines = JSON.parse(raw);
    if (!Array.isArray(lines)) throw new Error("Uventet svarformat fra modellen.");

    if (lines.length < sceneCount) {
      lines = [...lines, ...Array(sceneCount - lines.length).fill("")];
    } else if (lines.length > sceneCount) {
      lines = lines.slice(0, sceneCount);
    }

    res.status(200).json({ lines });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke generere manuskript: ${err.message}` });
  }
}
