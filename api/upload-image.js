// Serverless function (Vercel) — uploads a data:-URL image to Vercel Blob
// storage and returns its public URL. Luma's API requires publicly
// reachable image URLs; it cannot accept raw uploads or data: URIs.

import { put } from "@vercel/blob";

export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Kun POST er tilladt." });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(500).json({
      error: "Serveren mangler Blob Storage. Tilføj det under Vercel → Storage → Create Database → Blob.",
    });
    return;
  }

  const { dataUrl, filename } = req.body || {};
  if (!dataUrl) {
    res.status(400).json({ error: "Mangler dataUrl." });
    return;
  }

  try {
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!match) throw new Error("Ugyldigt billedformat (forventede en data:-URL).");
    const contentType = match[1];
    const buffer = Buffer.from(match[2], "base64");

    const blob = await put(filename || `rundvis-${Date.now()}.jpg`, buffer, {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });

    res.status(200).json({ url: blob.url });
  } catch (err) {
    res.status(500).json({ error: `Kunne ikke uploade billede: ${err.message}` });
  }
}
