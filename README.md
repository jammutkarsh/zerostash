# Zerostash

Free bookmarks in your own Cloudflare account. No subscription, no server to rent, and your links never sit on anyone else's servers.

- **Save** any page from Chrome or Firefox in one keystroke, with its title, image and description.
- **Find it again** with search, nested lists, and smart lists that fill themselves from a search.
- **Open it anywhere**: the web app works on any device.

Status: early. Tags, AI summaries, import, RSS and rules are on the way.

> I didn't want to pay ₹600 a month for a server just to run Karakeep. Zerostash keeps the parts I use and runs for free.

## Deploy

Fork the repo, connect it to Cloudflare, set one secret. Full guide: **[Deploy on Cloudflare Workers](docs/deployment/workers.md)**.

Updating later: [Upgrading Zerostash](docs/deployment/upgrading.md).

## Browser extension

- **Chrome, Edge, Brave:** [Zerostash on the Chrome Web Store](https://chromewebstore.google.com/detail/zerostash-%E2%80%93-bookmarks-on/jpoallbklhamdjpnhciegolbjbnncmai?authuser=0&hl=en)
- **Firefox:** `zerostash-firefox.xpi` from the [latest release](https://github.com/jammutkarsh/zerostash/releases/latest) ([how to install](docs/deployment/workers.md#5-install-the-browser-extension))

## Develop

```sh
bun install
cp .dev.vars.example .dev.vars        # set ZEROSTASH_SECRET
bun run db:migrate:local
bun run dev                           # web app + Worker on http://localhost:5173
bun run test                          # unit tests
bun run smoke                         # end-to-end API check against the dev server
bun run ext:build                     # extension → extension/dist/{chrome,firefox}
```

Load `extension/dist/chrome` via `chrome://extensions` → Developer mode → Load unpacked (Firefox: `about:debugging` → Load Temporary Add-on → `extension/dist/firefox/manifest.json`).

The API is described by an OpenAPI spec, served at `/openapi.json` and rendered at `/api-docs` on your server.

**Releasing:** bump `version` in `package.json` on `main`, then tag that commit (`git tag v0.2.0 && git push origin v0.2.0`). The tag publishes a GitHub release with the extension files, and fails if the tag and `package.json` disagree.

## Credits

Inspired by [Karakeep](https://github.com/karakeep-app/karakeep). Zerostash is an independent MIT-licensed project and shares no code with it.

Not to be confused with the Rust storage tool [symmetree-labs/zerostash](https://github.com/symmetree-labs/zerostash).
