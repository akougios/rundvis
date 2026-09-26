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

## AI-gennemgang (eksperimentel)

Genererer ét ægte AI-videoklip (Luma, `api/generate-flythrough/*`) for
selve indgangen — kameraet bevæger sig fra facaden, ind ad hoveddøren og
ind i det første rum, ud fra kun de første `FLYTHROUGH_ENTRY_KEYFRAME_COUNT`
(2) uploadede billeder (facade + første rum). Herefter fortsætter
visningen automatisk som en filmisk pan/zoom-gennemgang af de resterende
billeder, med `SceneLayer`/`kenBurnsParamsFor`-teknikken fra den scriptede
voiceover-visning: hvert rum får enten et zoom-ind, et zoom-ud eller en
panorering som hovedbevægelse, plus en anelse bevægelse på den anden akse
så det aldrig føles helt fladt/stillestående — dette varierer rum for rum
(deterministisk pr. billede-indeks, så rækkefølgen af effekter er stabil på
tværs af genindlæsninger). Hvert rum holdes 5,6-7,6 sekunder.

**Vigtigt: AI-klippets retning kan ikke garanteres 100 % ens hver gang.**
Luma's egen FAQ bekræfter at der ikke findes en `seed`-parameter og ingen
måde at få reproducerbart output på: "Each generation uses a different
random seed and there is no public seed parameter." Der er testet en lang
række opsætninger for at gøre resultatet så konsistent som muligt (se
"Historik" nedenfor) - 4-billeders multi-keyframe med en prompt der
eksplicit beder om ren fremadgående bevægelse er den mest pålidelige
opsætning fundet indtil videre, men en enkelt generering kan i sjældne
tilfælde stadig afvige. Der er en "Prøv igen"-knap i UI'et til at
genskabe klippet uden at skulle uploade billederne igen.

Kun de første 2 billeder sendes til Luma (koster reelt) - resten vises som
ren pan/zoom af de rigtige fotos, uden AI. Tager typisk 1-2 minutter at
generere. Der er ingen eksport til mp4/delbar fil for denne visning - kun
live-afspilning i browseren, ligesom den scriptede voiceover-visning
ovenfor.

### Historik: forsøg på at gøre AI-indgangen pålidelig

Der er afprøvet seks forskellige AI-genererede varianter for netop
"facade → ind ad hoveddøren"-overgangen: kædede per-segment-klip, ét
multi-keyframe-kald med hele billedserien, multi-keyframe med kun 2
billeder, 2-punkts `start_frame`/`end_frame`, forskellige prompt-ordlyde
(inkl. Luma's dokumenterede "camera push in"-frase), og til sidst
multi-keyframe med 4 billeder (facade + indgang + 2 rum), som gav et
korrekt resultat i test dengang, men senere alligevel viste samme fejl på
en frisk generering. Flere af de tidligere varianter viste samme fejl
undervejs: kameraet bevægede sig nogle gange baglæns/væk fra huset i
stedet for fremad gennem døren. Da flere billeder alene ikke løste det
holdbart (Luma har ingen seed-parameter, så selv en opsætning der virkede
én gang kan give et andet resultat næste gang), er opsætningen nu
skåret ned til kun 2 billeder (facade + første rum, `ENTRY_KEYFRAME_COUNT
= 2`) med en prompt der er langt mere eksplicit om præcis hvad billede 1
viser (facade, stillestående kamera) og hvad kameraet skal gøre derfra
(kun fremad ind i det første rum, aldrig væk fra huset). Kaldet sender nu
også Luma's strukturerede "camera concept" `push_in`
(docs.lumalabs.ai/changelog/concepts) som et ekstra, maskinlæsbart
retningshint ud over selve prompt-teksten - med automatisk retry uden det
felt, hvis Luma skulle afvise kaldet fordi det ikke understøttes sammen
med multi-keyframe. Der er stadig ingen garanti for 100 % konsistent
resultat, kun den mest direkte og eksplicitte retningsstyring afprøvet
indtil videre.
retningssignal at holde sig til.
