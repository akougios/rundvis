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
ud fra op til 8 billeder, via Luma Ray (model `ray-3.2`, Luma's nuværende
Agents API på `agents.lumalabs.ai/v1`). Den bruger Luma's **multi-keyframe
mode**: alle billederne sendes i ét samlet kald (`video.keyframes` — op til
64 billeder — + `video.keyframe_indexes`, som placerer hvert billede jævnt
fordelt på en tids-akse), i stedet for at kæde flere separate 2-billede-klip
sammen. Det betyder Luma ser hele rækkefølgen på én gang og planlægger ÉT
sammenhængende, fremadrettet kamera-flow hen over den — hvilket var
nødvendigt for at løse to problemer med den tidligere kæde-tilgang: klip der
nogle gange bevægede sig baglæns/væk fra huset, og synligt "rodet" limede
overgange mellem separat genererede klip.

Prompten (hardkodet server-side, i `api/generate-flythrough/create.js`)
beder eksplicit om en kamera-bevægelse der **kun bevæger sig fremad** —
aldrig baglæns, aldrig væk fra bygningen — i nøjagtig den rækkefølge
billederne er uploadet i (facade → dør → rum → rum...).

**Vigtigt om Luma-nøgler:** Luma migrerede i 2026 til en ny API
(`agents.lumalabs.ai`, nøgler i formatet `luma-api-...`). Den gamle
`api.lumalabs.ai/dream-machine/v1`-integration accepterer ikke disse nye
nøgler og fejler med "Not authenticated" — koden her bruger den nye API.

Der genereres nu kun ÉN video for hele gennemgangen (5 sek. ved præcis 2
billeder, ellers 10 sek.) — ikke længere separate klip man kan regenerere
enkeltvis. Fejler resultatet, må hele gennemgangen genereres forfra
("Generér forfra"-knappen). Kvaliteten bør stadig testes på rigtige
boligbilleder før det bruges i praksis. Ingen voiceover i denne pipeline;
kun det visuelle (+ evt. den eksisterende ambient baggrundsmusik, som endnu
ikke er koblet på afspilleren for dette flow).
