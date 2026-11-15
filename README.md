# Zerostash

Free bookmarks in your own Cloudflare account. No subscription, no server to rent, and your links never sit on anyone else's servers.

Save with the fast **Zerostash browser extension**, which reads the preview from the page you're on, or with any of **Karakeep's apps**: Zerostash speaks [Karakeep](https://github.com/karakeep-app/karakeep)'s API, so its phone apps, extension and tools work with your server too.

- **Save** pages, notes, images and PDFs from the extension, Karakeep's apps, or the Zerostash web app.
- **Find it again** with Karakeep's search syntax (`#tag`, `is:fav`, `list:"Reading"`, `after:2026-01-01`), tags, nested lists, and smart lists that fill themselves from a search.
- **Let it file itself**: AI tags and summaries, RSS feeds, rules that tag and file new bookmarks, and webhooks.
- **Open it anywhere**: the web app works on any device and keeps a copy of your library for instant search.

> I didn't want to pay ₹600 a month for a server just to run Karakeep. Zerostash keeps the parts I use and runs for free.

Not there yet: highlights and reader view, full-page archives, imports, and sharing lists with other people.

## Deploy

Fork the repo, connect it to Cloudflare, set one secret. Full guide: **[Deploy on Cloudflare Workers](docs/deployment/workers.md)**.

Updating later: [Upgrading Zerostash](docs/deployment/upgrading.md).

## Browser extension and apps

- **Zerostash extension:** [Chrome Web Store](https://chromewebstore.google.com/detail/zerostash-%E2%80%93-bookmarks-on/jpoallbklhamdjpnhciegolbjbnncmai) (Chrome, Edge, Brave); Firefox: `zerostash-firefox.xpi` from the [latest release](https://github.com/jammutkarsh/zerostash/releases/latest) ([how to install](docs/deployment/workers.md#5-install-the-browser-extension)).
- **Karakeep's apps:** the app for [iPhone](https://apps.apple.com/us/app/karakeep-app/id6479258022) or [Android](https://play.google.com/store/apps/details?id=app.hoarder.hoardermobile), or Karakeep's extension. Server address: your Worker URL; sign in with your `ZEROSTASH_SECRET` as the **API key** (or as the **password** with any email).

Tools built on Karakeep's REST API (its CLI, MCP server, Raycast extension, scripts) work the same way. The REST API is documented at `/api-docs` on your server.

## Develop

```sh
bun install
cp .dev.vars.example .dev.vars        # set ZEROSTASH_SECRET
bun run db:migrate:local
bun run dev                           # web app + Worker on http://localhost:5173
bun run test                          # unit tests (D1 is simulated with bun:sqlite)
bun run smoke                         # end-to-end check against the dev server, with Karakeep's client stack
bun run ext:build                     # extension → extension/dist/{chrome,firefox}
```

Load `extension/dist/chrome` via `chrome://extensions` → Developer mode → Load unpacked (Firefox: `about:debugging` → Load Temporary Add-on → `extension/dist/firefox/manifest.json`).

**Releasing:** bump `version` in `package.json` on `main`, then tag that commit (`git tag v1.1.0 && git push origin v1.1.0`). The tag publishes a GitHub release with the extension files (and is what forks' dashboards compare against for "Update available"). Chrome gets the extension through the Web Store: upload `extension/zerostash-chrome.zip` from `bun run ext:zip`. Privacy policy for the store listing: `/privacy-policy` on the server.

## Credits

Karakeep's API is reimplemented from its public contract. Zerostash is an independent MIT-licensed project and shares no code with Karakeep (AGPL).

Not to be confused with the Rust storage tool [symmetree-labs/zerostash](https://github.com/symmetree-labs/zerostash).
