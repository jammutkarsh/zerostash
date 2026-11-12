# Zerostash — bookmarks on your own Cloudflare, ₹0/month

Karakeep-style bookmarking (cards, tags, lists, AI summaries) that runs entirely on **Cloudflare's free tier**:
a Worker + D1 database you deploy to your own account, a web app, and a Chrome/Firefox extension.
No VPS, no Docker, no headless browser.

> I didn't want to pay ₹600 a month for a server just to run Karakeep. Zerostash keeps the parts I use and runs for free.

## What you get

| Piece | What it does |
|---|---|
| **Web app** | Browse, favourite, archive and delete bookmarks; paste a link or write a note to save it. Served as static files, so page views cost nothing. |
| **Background service** | One Cloudflare Worker + D1: the REST API ([OpenAPI spec](/openapi.json) at `/openapi.json` on your server), auth, and a 5-minute cron that fills in link previews. |
| **Browser extension** | One click saves the current page with its title, description and image. Right-click to save links or selected text. It also fetches previews for links you save elsewhere. |

Status: early. Lists (manual, nested and smart) and search work today; tags, AI summaries/tagging, import/export, RSS and rules are on the way.

## Deploy

Cloudflare builds and deploys your fork on every push to `main`, applying database migrations
before the new code goes live. That is the only way to deploy: `bun run deploy` refuses to run
anywhere but Cloudflare's build servers, so code can never ship without its migration.

> Not yet verified end to end on a fresh account. Please open an issue if a step doesn't match.

1. **Fork** [jammutkarsh/zerostash](https://github.com/jammutkarsh/zerostash/fork) on GitHub.
2. In the Cloudflare dashboard, go to **Workers & Pages → Create application → GitHub** and pick your fork.
   - Project name: `zerostash` (it must match `name` in `wrangler.jsonc`)
   - Build command: `bun run build`
   - Deploy command: `bun run deploy`
3. **Save and Deploy.** The first build creates the D1 database and queue, deploys, and migrates the database.
4. Add your login secret: open the Worker → **Settings → Variables and Secrets → Add** → type **Secret**,
   name `ZEROSTASH_SECRET`, value from `openssl rand -hex 32`. Keep a copy: it's your login.
5. Open `https://<your-worker>/login` and sign in with that secret. The root URL shows the marketing page
   until this browser has signed in; the app lives at `/dashboard`.

## Keep your server up to date

The dashboard shows your version in the sidebar and an **Update available** notice when a newer
[release](https://github.com/jammutkarsh/zerostash/releases) is out. Click **Sync fork** on your
GitHub fork: Cloudflare rebuilds, applies any new database migrations, then deploys.

**Releasing (maintainers):** bump `version` in `package.json` on `main` (that push deploys it), then
tag the same commit, e.g. `git tag v0.2.0 && git push origin v0.2.0`. The tag publishes a GitHub
release with the extension zips; it fails if the tag and `package.json` disagree.

## Connect the extension

Install the extension, enter your Worker URL and the same secret, then click **Allow link previews**.
Click the toolbar button (or press <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> on Mac, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> elsewhere) and choose **Stash this page**, or **Open Zerostash**. Turn on instant saving in the extension settings if you'd rather skip the click.

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
