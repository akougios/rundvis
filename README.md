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

**Status: 100% deterministisk, ingen AI-videogenerering.** Der er ikke
længere noget Luma-kald i dette flow (`api/generate-flythrough/*` ligger
stadig i repoet, men bruges ikke af frontend'en for øjeblikket) - se
"Historik" nedenfor for hvorfor.

Viser de første 8 uploadede billeder som en rolig fotomontage, i rækkefølge
(facade → indgang → rum for rum), genbruger samme `SceneLayer`/
`kenBurnsParamsFor`-teknik som den scriptede voiceover-visning ovenfor.
Facade-billedet (det første) får en langsommere, mere markant "push in"-
zoom for at sælge fornemmelsen af at nærme sig huset; resten af billederne
skifter mellem en næsten umærkelig zoom eller panorering (aldrig begge på
samme tid), hver holdt i 5,8-7,6 sekunder - et klassisk, roligt
boligfremvisnings-udtryk. Ingen upload, intet netværkskald, ingen
Luma-omkostning, og afspilningen starter øjeblikkeligt.

### Historik: hvorfor ikke AI-video?

Der blev afprøvet seks forskellige AI-genererede varianter for netop
"facade → ind ad hoveddøren"-overgangen: kædede per-segment-klip, ét
multi-keyframe-kald med hele billedserien, multi-keyframe med kun 2
billeder, 2-punkts `start_frame`/`end_frame`, forskellige prompt-ordlyde
(inkl. Luma's dokumenterede "camera push in"-frase), og til sidst
multi-keyframe med 4 billeder (facade + indgang + 2 rum), som gav et godt
resultat én gang. Alle varianter viste før eller siden samme fejl: kameraet
bevægede sig nogle gange baglæns/væk fra huset i stedet for fremad gennem
døren.

Luma's egen FAQ bekræfter at der ikke findes en `seed`-parameter og ingen
måde at få reproducerbart output på: "Each generation uses a different
random seed and there is no public seed parameter." Det betyder en
opsætning der virkede fint én gang sagtens kan give et dårligere resultat
næste gang, af ren tilfældighed - hvilket gør AI-video uegnet, når kravet
er et *konsistent* resultat hver gang. Derfor er hele funktionen nu
deterministisk pan/zoom på de rigtige billeder i stedet.

Der er ingen eksport til mp4/delbar fil for denne visning heller - kun
live-afspilning i browseren, ligesom den scriptede voiceover-visning
ovenfor.
