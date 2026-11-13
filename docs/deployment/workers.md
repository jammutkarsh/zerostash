# Deploy on Cloudflare Workers

Zerostash runs on Cloudflare's free plan. You need a GitHub account and a Cloudflare account. No server, no command line.

> Not yet verified end to end on a fresh account. If a step doesn't match what you see, please [open an issue](https://github.com/jammutkarsh/zerostash/issues).

## 1. Fork Zerostash and enable R2

Create a [fork of the Zerostash repository](https://github.com/jammutkarsh/zerostash/fork).

In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **R2 Object Storage** once and enable it. R2 stores uploaded images and PDFs. Its free tier (10 GB) is free, but Cloudflare asks for a payment method before turning it on.

You don't need to create anything else by hand. The first deploy creates these for you:

| Binding | Product     | Name              | What it's for                                      |
| ------- | ----------- | ----------------- | -------------------------------------------------- |
| `DB`    | D1 database | `zerostash`       | Bookmarks, lists, tags, feeds, rules, webhooks     |
| `FILES` | R2 bucket   | `zerostash-files` | Uploaded images and PDFs                           |
| `JOBS`  | Queue       | `zerostash-jobs`  | AI tagging, rules, webhooks, feed fetches          |
| `AI`    | Workers AI  | —                 | Free AI tags and summaries; reading page text      |
| —       | Cron        | every 5 minutes   | Retries link previews, queues RSS feeds, cleans up |

## 2. Connect Git (Workers Builds)

Go to **Workers & Pages → Create application → Import a repository** (GitHub), and pick your fork:

| Setting           | Value             |
| ----------------- | ----------------- |
| Project name      | `zerostash` (must match `name` in `wrangler.jsonc`) |
| Production branch | `main`            |
| Build command     | `bun run build`   |
| Deploy command    | `bun run deploy`  |

Click **Save and Deploy**. The first build creates the database and bucket, deploys the Worker, then sets up the database tables. Every later push to `main` updates the database first, then deploys.

`bun run deploy` only runs on Cloudflare's build servers. Running it on your own machine stops with an error on purpose, so new code can never go live without its database changes.

## 3. Set your secret

Once the first deploy finishes, open the Worker → **Settings → Variables and Secrets → Add**:

| Name               | Type   | Value |
| ------------------ | ------ | ----- |
| `ZEROSTASH_SECRET` | Secret | A random string of at least 32 characters, e.g. from `openssl rand -hex 32` |

This secret is your login for the web app and your API key for Karakeep's apps. Keep a copy in your password manager. Changing it signs you out everywhere.

Optional, for AI tags and summaries with your own model instead of the free Workers AI one. Add one key (the first one set wins):

| Name                | Default model      |
| ------------------- | ------------------ |
| `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` |
| `OPENAI_API_KEY`    | `gpt-6.1-terra`    |
| `GEMINI_API_KEY`    | `gemini-3.8-flash` |
| `AI_API_KEY` + `AI_BASE_URL` + `AI_MODEL` | Any other OpenAI-compatible API (OpenRouter, DeepSeek, ...): you pick the model |

`AI_MODEL` swaps in a different model for whichever provider is in use. `ZEROSTASH_AI=off` turns AI off entirely.

You can also turn automatic tagging and summaries off in the web app's **Settings**.

## 4. Sign in

Open `https://zerostash.<your-subdomain>.workers.dev/login` and sign in with the secret. The app lives at `/dashboard`. The site's root shows the welcome page until this browser has signed in.

To use your own domain, add it under the Worker's **Settings → Domains & Routes**. Deploys keep it.

## 5. Connect Karakeep's apps

Zerostash speaks Karakeep's API, so Karakeep's own clients save straight into your server:

- **Browser:** the Karakeep extension for [Chrome](https://chromewebstore.google.com/detail/karakeep/kgcjekpmcjjogibpjebkhaanilehneje) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/karakeep/)
- **Phone:** the Karakeep app for [iPhone](https://apps.apple.com/us/app/karakeep-app/id6479258022) or [Android](https://play.google.com/store/apps/details?id=app.hoarder.hoardermobile)

Enter your Worker URL as the **server address**, then sign in with your secret as the **API key** (or as the **password**, with any email).

Screens for features Zerostash doesn't have yet (highlights, sharing lists) show up empty.

Later updates: [Upgrading Zerostash](./upgrading.md).
