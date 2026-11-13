# Zerostash

Free bookmarks in your own Cloudflare account. No subscription, no server to rent, and your links never sit on anyone else's servers.

Zerostash speaks [Karakeep](https://github.com/karakeep-app/karakeep)'s API, so **Karakeep's browser extension and mobile apps work with it**. Point them at your Zerostash server instead of a Karakeep one.

- **Save** pages, notes, images and PDFs from Karakeep's extension or apps, or from the Zerostash web app.
- **Find it again** with Karakeep's search syntax (`#tag`, `is:fav`, `list:"Reading"`, `after:2026-01-01`), tags, nested lists, and smart lists that fill themselves from a search.
- **Let it file itself**: AI tags and summaries, RSS feeds, rules that tag and file new bookmarks, and webhooks.
- **Open it anywhere**: the web app works on any device and keeps a copy of your library for instant search.

> I didn't want to pay ₹600 a month for a server just to run Karakeep. Zerostash keeps the parts I use and runs for free.

Not there yet: highlights and reader view, full-page archives, imports, and sharing lists with other people.

## Deploy

Fork the repo, connect it to Cloudflare, set one secret. Full guide: **[Deploy on Cloudflare Workers](docs/deployment/workers.md)**.

Updating later: [Upgrading Zerostash](docs/deployment/upgrading.md).

## Use Karakeep's apps

Install one of Karakeep's clients: the extension for [Chrome](https://chromewebstore.google.com/detail/karakeep/kgcjekpmcjjogibpjebkhaanilehneje) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/karakeep/), or the app for [iPhone](https://apps.apple.com/us/app/karakeep-app/id6479258022) or [Android](https://play.google.com/store/apps/details?id=app.hoarder.hoardermobile). Then:

- **Server address:** your Worker URL, e.g. `https://zerostash.<you>.workers.dev`
- **Sign in** with your `ZEROSTASH_SECRET` as the **API key**, or as the **password** with any email.

Tools built on Karakeep's REST API (its CLI, MCP server, Raycast extension, scripts) work the same way: your server's address plus the secret as the API key. The REST API is documented at `/api-docs` on your server.

## Develop

```sh
bun install
cp .dev.vars.example .dev.vars        # set ZEROSTASH_SECRET
bun run db:migrate:local
bun run dev                           # web app + Worker on http://localhost:5173
bun run test                          # unit tests (D1 is simulated with bun:sqlite)
bun run smoke                         # end-to-end check against the dev server, with Karakeep's client stack
```

**Releasing:** bump `version` in `package.json` on `main`, then tag that commit (`git tag v1.0.0 && git push origin v1.0.0`). The tag publishes a GitHub release, which forks' dashboards use for their "Update available" notice.

## Credits

Karakeep's API is reimplemented from its public contract. Zerostash is an independent MIT-licensed project and shares no code with Karakeep (AGPL).

Not to be confused with the Rust storage tool [symmetree-labs/zerostash](https://github.com/symmetree-labs/zerostash).
