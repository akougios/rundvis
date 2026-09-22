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

## Vigtigt at vide om denne prototype

- **Manuskript-generering er ægte** — kalder Claude via `/api/generate-script`.
- **Voiceoveren er browserens indbyggede tale-syntese** (dansk, hvis enheden har en
  dansk stemme installeret) — ikke en professionel AI-stemme endnu.
- **Kamerabevægelsen er simuleret** med CSS pan/zoom (Ken Burns-effekt) på de
  originale billeder — det er *ikke* ægte AI-videogenerering med dybde og
  realistisk bevægelse gennem rummet. For det skal en rigtig
  billede-til-video-model (fx Runway, Kling eller Luma) kobles på via deres API.
- **Der er ingen eksport til mp4/delbar fil** — kun live-afspilning i browseren.
- Ingen database, ingen brugerlogin, ingen betaling — ren UX/flow-prototype.
