# Commander Collection Manager

A small web app: upload your ManaBox collection CSV (saved permanently),
browse and filter it, and build Commander decks using EDHREC synergy data
cross-referenced against only the cards you actually own.

## How it works

1. You upload your ManaBox collection export (CSV) once. It's saved to a
   database so it's there every time you come back &mdash; no re-uploading
   each visit.
2. On the **Collection** tab, browse your saved collection with filters for
   rarity, foil/non-foil, condition, and binder, plus sorting by name,
   price, rarity, or quantity. You can **add** more cards later (merging
   into what's already saved) or **replace** the whole collection with a
   fresh export.
3. On the **Build a Deck** tab, search your owned cards, pick one as your
   commander, and the app does a single Scryfall lookup to confirm it's a
   legal commander, then fetches that commander's live EDHREC page and
   shows only the cards you own, ranked by synergy score.

Cards in a ManaBox "list"-type binder (like a wishlist) are excluded from
what counts as "owned" for deck-building, except a binder literally named
"sell list", which is still treated as owned.

## Deploying it (no coding required)

### Step 1: Deploy the app itself

The easiest free option is **Vercel**, the company that makes Next.js (the
framework this app is built with).

1. Go to [github.com](https://github.com) and create a free account if you
   don't have one.
2. Create a new repository and upload all the files in this folder to it
   (GitHub's website lets you drag-and-drop files to upload).
3. Go to [vercel.com](https://vercel.com) and sign up for free using your
   GitHub account.
4. Click **"Add New Project"**, select the repository you just created, and
   click **Deploy**. Leave all settings at their defaults.

### Step 2: Add a database (required for saving your collection)

Without this step, the Collection tab will show an error when you try to
upload &mdash; there's nowhere to save the data yet.

1. In your project on vercel.com, open the **Storage** tab.
2. Under Marketplace Database Providers, find **Redis** and select
   **Create**.
3. Pick a region close to you, choose the free plan, and click **Continue**,
   then **Create**.
4. Once it says "Available" (may need a page refresh), make sure it's
   **connected to this project** &mdash; Vercel usually does this
   automatically as part of creating it from within the project, but double
   check under the database's "Projects" tab.
5. Go to your project's **Settings &rarr; Environment Variables** and
   confirm some Redis-related variables were added automatically (names
   like `KV_REST_API_URL` / `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`
   / `UPSTASH_REDIS_REST_TOKEN`). If you don't see any of those exact names,
   add two variables yourself named `REDIS_URL` and `REDIS_TOKEN`, copying
   the values from whatever connection details your new database's page
   shows under "Quickstart" or ".env".
6. Redeploy the project (Deployments tab &rarr; \u22ee menu on the latest
   deployment &rarr; Redeploy) so it picks up the new environment variables.

After that, uploading a collection on the Collection tab should work and
persist across visits.

### Option B: Deploy via the command line (if you're comfortable with a terminal)

```bash
npm install -g vercel
cd mtg-synergy-app
npm install
vercel
```

Follow the prompts (accept the defaults), then follow Step 2 above in the
Vercel dashboard to add the database.

## Running it locally first (optional)

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in your browser. You'll need a `.env.local`
file with `REDIS_URL` and `REDIS_TOKEN` (or the Vercel-provided equivalents)
for the Collection tab to work locally.

## Known limitations / things that may need tweaking

- **Commander URL guessing**: EDHREC pages are found by guessing a URL slug
  from the commander's name (e.g. "Jodah, the Unifier" &rarr;
  `jodah-the-unifier`). This works for the vast majority of commanders, but
  a handful with unusual punctuation might not resolve.
- **EDHREC page structure**: This app reads data directly off EDHREC's public
  pages since they don't offer an official API. If EDHREC redesigns their
  site, the scraping logic in `lib/edhrec.js` may need small updates.
- **Scryfall usage**: The app only ever looks up one card at a time (whichever
  commander you pick), rather than bulk-checking your whole collection, which
  avoids rate limits entirely under normal use.
- **Single shared collection**: There's no login system, so this app has one
  collection shared by anyone who visits your deployed URL. Fine for personal
  use; not meant for multiple people to keep separate collections.
- **Partner/Background commanders**: The app currently supports picking one
  commander at a time. Two-commander partner pairs aren't combined yet.
- **No deck allocation yet**: The Build a Deck tab shows synergy for your
  whole owned collection - it doesn't yet track which cards are already used
  in another built deck (that's a planned future upgrade).
