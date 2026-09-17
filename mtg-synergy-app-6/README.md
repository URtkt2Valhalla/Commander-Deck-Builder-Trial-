# Commander Synergy Finder

A small web app: upload your ManaBox collection CSV, pick a commander you own,
and see which of your own cards EDHREC says have the best synergy with it.

## How it works

1. You upload your ManaBox collection export (CSV) in the browser.
2. You search for a card you own to use as your commander &mdash; this
   search happens instantly in your browser against your uploaded
   collection, with no server calls needed until you pick one.
3. You pick one. The app does a single Scryfall lookup to confirm it's a
   legal commander, then fetches that commander's live EDHREC page, pulls
   out every card's synergy score, and shows you only the cards you already
   own, ranked highest synergy first.

No account, no database — nothing is stored anywhere. Each visit starts fresh.

## Deploying it (no coding required)

The easiest free option is **Vercel**, the company that makes Next.js (the
framework this app is built with). This gets you a real, working URL you can
open from any device.

### Option A: Deploy via the Vercel website (recommended, no terminal needed)

1. Go to [github.com](https://github.com) and create a free account if you
   don't have one.
2. Create a new repository and upload all the files in this folder to it
   (GitHub's website lets you drag-and-drop files to upload).
3. Go to [vercel.com](https://vercel.com) and sign up for free using your
   GitHub account.
4. Click **"Add New Project"**, select the repository you just created, and
   click **Deploy**. Leave all settings at their defaults — Vercel
   automatically detects this is a Next.js app.
5. After a minute or two, Vercel will give you a live URL
   (something like `your-project.vercel.app`). That's your working website.

### Option B: Deploy via the command line (if you're comfortable with a terminal)

```bash
npm install -g vercel
cd mtg-synergy-app
npm install
vercel
```

Follow the prompts (accept the defaults). Vercel will give you a live URL at
the end.

## Running it locally first (optional)

If you want to try it on your own computer before deploying:

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in your browser.

## Known limitations / things that may need tweaking

- **Commander URL guessing**: EDHREC pages are found by guessing a URL slug
  from the commander's name (e.g. "Jodah, the Unifier" &rarr;
  `jodah-the-unifier`). This works for the vast majority of commanders, but
  a handful with unusual punctuation might not resolve — if a commander
  fails, the app will tell you clearly rather than showing wrong data.
- **EDHREC page structure**: This app reads data directly off EDHREC's public
  pages since they don't offer an official API. If EDHREC redesigns their
  site, the scraping logic in `lib/edhrec.js` may need small updates.
- **Scryfall usage**: The app only ever looks up one card at a time (whichever
  commander you pick), rather than bulk-checking your whole collection. This
  is both faster and avoids Scryfall's rate limits entirely under normal use.
- **Partner/Background commanders**: The app currently supports picking one
  commander at a time. Two-commander partner pairs aren't combined yet.
