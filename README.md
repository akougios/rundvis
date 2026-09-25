# Rundvis — prototype

Statisk frontend (`public/index.html`) + én serverless-funktion (`api/generate-script.js`)
der holder på Anthropic API-nøglen sikkert på serversiden, så manuskript-generering virker
for alle der besøger sitet — ikke kun i Claude.

## Deploy til Vercel (ca. 5 minutter)

1. **Opret et GitHub-repo og push denne mappe:**
   ```
   cd rundvis-app
   git init
   git add .
   git commit -m "Rundvis prototype"
   git branch -M main
   git remote add origin https://github.com/<dit-brugernavn>/rundvis.git
   git push -u origin main
   ```

2. **Gå til [vercel.com](https://vercel.com)**, log ind med GitHub, og vælg
   "Add New… → Project". Vælg `rundvis`-repoet. Vercel finder automatisk
   `public/` og `api/`-mapperne — du behøver ikke ændre nogen build-indstillinger.

3. **Tilføj din API-nøgle** under Project → Settings → Environment Variables:
   - Key: `ANTHROPIC_API_KEY`
   - Value: din nøgle fra [console.anthropic.com](https://console.anthropic.com)
   - Gælder for: Production, Preview og Development

4. **Deploy.** Du får et gratis link i stil med `rundvis.vercel.app`, som du kan
   sende til hvem som helst — ingen Claude-konto krævet.

## Lokal test (valgfrit)

Kræver [Vercel CLI](https://vercel.com/docs/cli):
```
npm i -g vercel
cd rundvis-app
vercel dev
```
Sæt `ANTHROPIC_API_KEY` i en `.env` fil eller via `vercel env pull` først.

## Miljøvariabler (Vercel → Settings → Environment Variables)

- `ANTHROPIC_API_KEY` — manuskript-generering (`/api/generate-script`)
- `ELEVENLABS_API_KEY` — AI-stemme (`/api/generate-voice`)
- `ELEVENLABS_VOICE_ID` (valgfri) — override standard-stemmen (default: "Sarah", `EXAVITQu4vr4xnSDxMaL`)
- `LUMA_API_KEY` — AI-gennemgang / flythrough (`/api/generate-flythrough/*`)
- `BLOB_READ_WRITE_TOKEN` — sættes automatisk når du opretter en Blob Store under
  Vercel → Storage → Create Database → Blob, og forbinder den til projektet.
  Kræves af `/api/upload-image` for at give Luma offentlige billed-URL'er.

## Vigtigt at vide om denne prototype

- **Manuskript-generering er ægte** — kalder Claude via `/api/generate-script`.
- **Voiceoveren er ægte AI-stemme fra ElevenLabs** via `/api/generate-voice`. Falder
  automatisk tilbage til browserens indbyggede tale for en given scene, hvis
  ElevenLabs-kaldet fejler (fx manglende nøgle eller rate-limit).
- **Kamerabevægelsen er stadig simuleret** — CSS-baseret pan/zoom (Ken Burns), nu med
  varierede bevægelsesmønstre per scene, blød crossfade mellem scener, vignette og
  synkroniseret varighed med den faktiske stemmelængde. Det er *ikke* ægte
  AI-videogenerering med reel dybde og bevægelse gennem rummet — for det skal en
  billede-til-video-model (fx Runway, Kling eller Luma) kobles på via deres API.
- **Baggrundsmusik** er en simpel, syntetisk genereret ambient-pad (Web Audio API,
  ingen ekstern lydfil) — kan slås til/fra under afspilning.
- **Der er ingen eksport til mp4/delbar fil** — kun live-afspilning i browseren.
- Ingen database, ingen brugerlogin, ingen betaling — ren UX/flow-prototype.

## AI-gennemgang (eksperimentel, `/api/generate-flythrough/*`)

En separat, dyrere pipeline der genererer en ægte AI-video (ikke CSS-simuleret)
ud fra op til 8 billeder, via Luma Ray-2. Da Luma's offentlige API kun
understøtter 2 keyframes (start/slut) per kald — ikke reelt 16 keyframes i ét
sammenhængende klip — er det bygget som en **kæde af klip**: hvert nyt klip
fortsætter kamerabevægelsen fra slutningen af det forrige (`frame0: {type:
"generation", id: <forrige klips id>}`) mod næste stillbillede (`frame1:
{type: "image", url: ...}`). Browseren afspiller segmenterne i træk ved at
skifte `<video>`-kildens `src` når hvert klip slutter.

Vigtigt: dette er ikke ét enkelt uafbrudt kamera-flow — det er en kæde af
5-sekunders klip der hver fortsætter bevægelsen fra det forrige. Kvaliteten
af overgangene bør testes på rigtige boligbilleder før det bruges i praksis.
Ingen voiceover i denne pipeline; kun det visuelle (+ evt. den eksisterende
ambient baggrundsmusik, som endnu ikke er koblet på afspilleren for dette
flow).
