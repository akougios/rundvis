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

Laver en filmisk gennemgang af op til `MAX_FLYTHROUGH_IMAGES` (8) af de
uploadede billeder, hvor kameraet bevæger sig gennem **hvert** billede i
ægte 3D — ikke bare et fladt CSS pan/zoom, men en rigtig parallakse-effekt
hvor forgrund og baggrund bevæger sig forskelligt fra hinanden, som et
kamera der faktisk bevæger sig i rummet.

Teknikken (se `estimateDepthCanvas`, `parallaxPathFor` og `ParallaxLayer`
i `public/index.html`):

1. Hvert billede køres gennem en dybde-estimeringsmodel
   (`onnx-community/depth-anything-v2-small`, via `@huggingface/transformers`)
   **direkte i browseren** — ingen server, ingen API-nøgle, ingen
   per-generering-omkostning.
2. Dybdekortet bruges til at bygge et forskudt 3D-mesh af billedet
   (three.js) — nære pixels skubbes mod kameraet, fjerne pixels bliver.
3. Et virtuelt kamera bevæger sig gennem det mesh langs en fast,
   deterministisk bane pr. billede-indeks (`push` for facaden/første
   billede, ellers skiftevis `push`/`pan`/`orbit`), samme
   `seededRandom`-teknik som resten af appen bruger, så rækkefølgen af
   bevægelser er stabil på tværs af genindlæsninger.

Det er **fuldstændig deterministisk**: samme billeder giver altid samme
dybdekort og dermed samme kamerabevægelse — modsat AI-videogenerering
(Luma/Runway/Kling), hvor der ikke findes nogen `seed`-parameter, og
kameraet derfor kan finde på at bevæge sig i en anden retning fra gang til
gang (se "Historik" nedenfor for den lange række forsøg på at gøre en
Luma-baseret løsning pålidelig, som endte med at blive opgivet til fordel
for denne tilgang).

Beregningen tager typisk et par sekunder pr. billede (model indlæses én
gang og caches). Der er ingen eksport til mp4/delbar fil for denne visning
endnu — kun live-afspilning i browseren, ligesom den scriptede
voiceover-visning ovenfor.

### Historik: fra AI-videogenerering til deterministisk 3D-parallakse

Tidligere brugte AI-gennemgangen Luma AI (`api/generate-flythrough/*`) til
at generere et rigtigt AI-videoklip for facade → indgang. Koden er stadig
i repoet, men er ikke længere koblet til frontenden.

Der blev afprøvet en lang række opsætninger for at gøre Luma-klippet
pålideligt: kædede per-segment-klip, ét multi-keyframe-kald med hele
billedserien, multi-keyframe med kun 2 billeder, 2-punkts
`start_frame`/`end_frame`, forskellige prompt-ordlyde (inkl. Luma's
dokumenterede "camera push in"-frase og det strukturerede "camera concept"
`push_in`-felt), og til sidst multi-keyframe skåret ned til kun 2 billeder
med en meget eksplicit prompt. Fejlen gik igen på tværs af næsten alle
varianter: kameraet bevægede sig nogle gange baglæns/væk fra huset i
stedet for fremad gennem døren, og fordi Luma ikke har nogen
seed-parameter, kunne selv en opsætning der virkede én gang give et andet
resultat næste gang.

Research i konkurrenten Reel-E.ai's tilgang, samt Runway Gen-4.5 og Kling
AI's API'er, viste at det ikke var en Luma-specifik fejl: struktureret,
pålidelig kamerastyring findes kun til animation af **ét enkelt billede**
hos alle tre udbydere — aldrig til interpolation mellem to forskellige
billeder (dual-image/start-end-frame), som var netop det AI-gennemgangen
bad om. Det gjorde "kameraet går den forkerte vej"-fejlen til et
strukturelt, branchebredt problem frem for noget der kunne prompt-fikses
væk.

Løsningen blev derfor at droppe AI-videogenerering for denne funktion helt
og erstatte den med ægte, deterministisk 3D-parallakse beregnet lokalt i
browseren (beskrevet ovenfor) — valideret først i to midlertidige,
isolerede testsider deployet direkte til Vercel (three.js-rendering af et
dybde-forskudt mesh, og klient-side dybde-estimering med
`@huggingface/transformers`), før teknikken blev bygget ind i den rigtige
app.

---

## Nuværende arkitektur (efter 3D-forsøget)

Historikken ovenfor beskriver depth-parallax-løsningen. Den er nu udskiftet,
og det er værd at vide hvorfor, så den ikke bliver genopfundet:

**Depth-parallax blev droppet.** På rigtige boligfotos bøjede den billederne
synligt — loftsbrædder der var lige i fotoet blev buede. Det er ikke en fejl
der kan justeres væk: teknikken forskyder hver pixel efter et *estimeret*
dybdekort, og estimatet er aldrig perfekt. Kravet om troskab mod de
uploadede fotos og teknikken "ægte 3D fra ét foto" udelukker hinanden.

Funktionen består nu af to lag:

**1. Storyboard (gratis, øjeblikkeligt).** Ren 2D: kameraet flytter *rammen*
hen over fotoet, aldrig pixels. Hver udgangspixel er en direkte gengivelse
af originalen, så intet bøjer. Sorte kanter er umulige ved konstruktion.
Beskæring 0–15,8 %; første og sidste klip vises helt ubeskåret.

**2. Høj kvalitet (betalt, valgfrit).** Hvert foto sendes til en
image-to-video-model, der laver et klip med rigtig kamerabevægelse gennem
rummet. Et klip er 5 sekunder, men de fleste klip står kun 2–3 sekunder på
skærmen, fordi det matcher tempoet i rigtige boligvideoer.

Hvilken del af klippet der vises, er en afvejning. Luma binder det uploadede
foto til frame 0, så klippet åbner som fotografiet præcis og driver længere væk
jo længere det kører: starten er mest tro mod boligen, men også der hvor
kameraet stadig er ved at komme i gang. Korte klip springer derfor et stykke ind
— en brøkdel af den ubrugte del, højst ét sekund — så de viser bevægelsen frem
for optrapningen. Lange klip, åbningen og afslutningen først og fremmest, starter
ved nul og åbner på fotoet urørt (`clipStartFor`).

Udvælgelsen af hvilke rum der får et klip, når ikke hele boligen opgraderes:
filmen deles i lige så mange afsnit som der er klip at bruge, og det klip der
står længst på skærmen i hvert afsnit får et. Målt er det næsten uden betydning
— både denne og en jævn fordeling efter position lander under 39 % af spilletiden
ved 18 billeder, fordi en jævn fordeling allerede rammer den lange åbning og
afslutning. Den er beholdt fordi den aldrig er dårligere, men det egentlige spild
er at et klip er 5 sekunder og de fleste klip er under 3.

Begge lag deler samme klipning (`buildEditPlan`, `composeShowFrame`):
beat-gitter på 116 BPM, hårde klip, dissolves, speed ramps, vignette. Det er
klipningen der gør en boligvideo lækker, og den er uafhængig af hvordan
billederne bevæger sig.

### Nødvendige miljøvariabler i Vercel

| Variabel | Bruges til |
|---|---|
| `LUMA_API_KEY` | Videogenerering. Uden den virker storyboardet stadig; kun opgraderingen fejler, med en forklarende besked. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob. Videomodellen kræver et offentligt tilgængeligt billede-URL. Sættes automatisk når en Blob Store oprettes under Vercel → Storage og forbindes til projektet. |
| `VIDEO_PROXY_SECRET` | Valgfri. Nøgle til at signere video-URL'er. Falder tilbage til `LUMA_API_KEY` hvis den ikke er sat. |

### Én model, ikke et modelvalg

Luma Ray 3.2. Fire modeller blev sammenlignet side om side på rigtige boligfotos
(Kling 2.6 Pro, Seedance 1.0 Pro, Luma Ray 2 og Ray 3.2); Ray 3.2 holdt rummene
bedst, og de øvrige blev **fjernet** frem for at blive efterladt som valgmuligheder.
Sammenligningsopstillingen ligger i git-historikken hvis en model skal vurderes igen.

Begrundelsen er ikke teknisk men produktmæssig: et valg mellem modeller som
ejendomsmægleren ikke har nogen mulighed for at bedømme, er ikke en funktion — det
er en beslutning skubbet over på brugeren.

| Kvalitet | Opløsning | Pr. klip |
|---|---|---|
| Test | 720p | ~0,45 $ |
| Fuld kvalitet | 1080p | ~0,95 $ |

Test findes så et rum kan tjekkes for under det halve: hvis modellen bøjer noget
i 720p, gør den det også i 1080p.

Opgraderingen er derfor to trin i appen, i den rækkefølge: **"Prøv det på ét rum"**
(ét klip, ~0,45 $) før **"Opgradér videoen"** (resten af boligen, med prisen
skrevet på knappen). Første trin findes for at et rum kan bedømmes på egne fotos,
før der bliver brugt mere.
