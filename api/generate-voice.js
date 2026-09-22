// Serverless function (Vercel) — calls ElevenLabs text-to-speech.
// The browser never sees ELEVENLABS_API_KEY; it only calls this endpoint
// and gets back an mp3 audio stream.

// "Sarah" — a stable ElevenLabs premade voice that reads well in Danish
// via the multilingual model. Override with ELEVENLABS_VOICE_ID if you
// want to swap in a different (or cloned) voice.
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Serveren mangler en ELEVENLABS_API_KEY. Sæt den under Vercel → Settings → Environment Variables.",
    });
    return;
  }

  const { text } = req.body || {};
  if (!text || !text.trim()) {
    res.status(400).json({ error: "Mangler tekst at generere stemme for." });
    return;
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  try {
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!elevenRes.ok) {
      const errText = await elevenRes.text();
      res.status(elevenRes.status).json({ error: `ElevenLabs-fejl: ${errText}` });
      return;
    }

    const arrayBuffer = await elevenRes.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke generere stemme: ${err.message}` });
  }
}
