# Deploy on Cloudflare Workers

Zerostash runs on Cloudflare's free plan. You need a GitHub account and a Cloudflare account. No server, no command line.

> Not yet verified end to end on a fresh account. If a step doesn't match what you see, please [open an issue](https://github.com/jammutkarsh/zerostash/issues).

## 1. Fork Zerostash

Create a [fork of the Zerostash repository](https://github.com/jammutkarsh/zerostash/fork).

You don't need to create anything in Cloudflare by hand. The first deploy creates these for you:

| Binding | Product     | Name             | What it's for                  |
| ------- | ----------- | ---------------- | ------------------------------ |
| `DB`    | D1 database | `zerostash`      | Stores your bookmarks and lists |
| `JOBS`  | Queue       | `zerostash-jobs` | Reserved for AI features       |
| —       | Cron        | every 5 minutes  | Fills in missing link previews |

## 2. Connect Git (Workers Builds)

In the [Cloudflare dashboard](https://dash.cloudflare.com/), go to **Workers & Pages → Create application → Import a repository** (GitHub), and pick your fork:

| Setting           | Value             |
| ----------------- | ----------------- |
| Project name      | `zerostash` (must match `name` in `wrangler.jsonc`) |
| Production branch | `main`            |
| Build command     | `bun run build`   |
| Deploy command    | `bun run deploy`  |

Click **Save and Deploy**. The first build creates the database, deploys the Worker, then sets up the database tables. Every later push to `main` updates the database first, then deploys.

`bun run deploy` only runs on Cloudflare's build servers. Running it on your own machine stops with an error on purpose, so new code can never go live without its database changes.

## 3. Set your secret

Once the first deploy finishes, open the Worker → **Settings → Variables and Secrets → Add**:

| Name               | Type   | Value |
| ------------------ | ------ | ----- |
| `ZEROSTASH_SECRET` | Secret | A random string of at least 32 characters, e.g. from `openssl rand -hex 32` |

This secret is your login for the web app and the extension. Keep a copy in your password manager. Changing it signs you out everywhere.

## 4. Sign in

Open `https://zerostash.<your-subdomain>.workers.dev/login` and sign in with the secret. The app lives at `/dashboard`. The site's root shows the welcome page until this browser has signed in.

To use your own domain, add it under the Worker's **Settings → Domains & Routes**. Deploys keep it.

## 5. Install the browser extension

- **Chrome, Edge, Brave:** install [Zerostash from the Chrome Web Store](https://chromewebstore.google.com/detail/jpoallbklhamdjpnhciegolbjbnncmai).
- **Firefox:** download `zerostash-firefox.xpi` from the [latest release](https://github.com/jammutkarsh/zerostash/releases/latest). Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**, and pick the file. Firefox removes temporary add-ons when it restarts, so you'll need to load it again after a restart.

In the extension's settings, enter your **Server** URL and your **Secret**, then click **Allow link previews**. This lets your browser fetch titles and images for what you save.

Save a page with the toolbar button, <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> on Mac, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> elsewhere. You can also right-click any link.

Later updates: [Upgrading Zerostash](./upgrading.md).
