# Zerostash — bookmarks on your own Cloudflare, ₹0/month

Karakeep-style bookmarking (cards, tags, lists, AI summaries) that runs entirely on **Cloudflare's free tier**:
a Worker + D1 database you deploy to your own account, a web app, and a Chrome/Firefox extension.
No VPS, no Docker, no headless browser.

> I didn't want to pay ₹600 a month for a server just to run Karakeep. Zerostash keeps the parts I use and runs for free.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jammutkarsh/zerostash)

## What you get

| Piece | What it does |
|---|---|
| **Web app** | Browse, favourite, archive and delete bookmarks; paste a link or write a note to save it. Served as static files, so page views cost nothing. |
| **Background service** | One Cloudflare Worker + D1: the REST API ([OpenAPI spec](/openapi.json) at `/openapi.json` on your server), auth, and a 5-minute cron that fills in link previews. |
| **Browser extension** | One click saves the current page with its title, description and image. Right-click to save links or selected text. It also fetches previews for links you save elsewhere. |

Status: early. Tags, lists, AI summaries/tagging, search, import/export, RSS and rules are on the way.

## Deploy

> The command-line path below is tested. The Deploy button and fork + Workers Builds paths are not verified yet.

1. Click **Deploy to Cloudflare** above. Cloudflare copies this repo to your GitHub, creates the D1 database and deploys.
2. When asked for `ZEROSTASH_SECRET`, paste a long random string (`openssl rand -hex 32`). It's your login.
3. Open your Worker's URL and sign in with that secret.

From the command line instead:

```sh
git clone https://github.com/jammutkarsh/zerostash && cd zerostash
bun install
npx wrangler login
bun run deploy                             # builds, creates the database + queue, deploys, migrates
openssl rand -hex 32 | npx wrangler secret put ZEROSTASH_SECRET   # keep a copy: it's your login
```

## Connect the extension

Install the extension, enter your Worker URL and the same secret, then click **Allow link previews**.
That's it — the toolbar button, <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> on Mac or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> elsewhere, saves the current page.

## Why it stays free

- The web app is static assets (free and unlimited); only `/api/*` runs the Worker.
- Previews are read by your browser first; the server only fills gaps, reading just the page `<head>`.
- Every list query uses an index and cursor pagination, so the 5M rows/day read allowance goes a long way.

Free-tier limits are per Cloudflare account and shared with your other Workers/D1 projects.

## Develop

```sh
bun install
cp .dev.vars.example .dev.vars        # set ZEROSTASH_SECRET
bun run db:migrate:local
bun run dev                           # web app + Worker on http://localhost:5173
bun run smoke                         # end-to-end API check against the dev server
bun run test                          # unit tests
bun run ext:build                     # extension → extension/dist/{chrome,firefox}
```

Load `extension/dist/chrome` via `chrome://extensions` → Developer mode → Load unpacked (Firefox: `about:debugging` → Load Temporary Add-on → `extension/dist/firefox/manifest.json`).

## Credits

Inspired by [Karakeep](https://github.com/karakeep-app/karakeep). Zerostash is an independent MIT-licensed project and shares no code with it.

Not to be confused with the Rust storage tool [symmetree-labs/zerostash](https://github.com/symmetree-labs/zerostash).
