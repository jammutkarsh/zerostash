# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Zerostash: a Karakeep-style bookmark manager that runs entirely on Cloudflare's **free tier** — one Worker (Hono API + static Svelte SPA) with D1, plus a Chrome/Firefox MV3 extension. Bun workspaces: the root is the deployable app, `extension/` is its own workspace.

## Commands

```sh
bun install
cp .dev.vars.example .dev.vars          # set ZEROSTASH_SECRET (≥32 chars)
bun run db:migrate:local                # apply migrations/ to local D1
bun run dev                             # SPA + Worker together on http://localhost:5173

bun run check                           # svelte-check (web+shared) + tsc (server, tsconfig.worker.json)
bun run --filter zerostash-extension check
bun run test                            # bun test over shared/ server/ web/
bun test server/auth.test.ts            # one file;  bun test -t "name" for one test
bun run smoke                           # end-to-end API check; needs `bun run dev` running
bun run types                           # regenerate server/worker-configuration.d.ts after editing wrangler.jsonc
bun run build                           # writes public/openapi.json, then vite build
bun run ext:build                       # extension → extension/dist/{chrome,firefox}
```

CI (`.github/workflows/ci.yml`) runs: types, check, extension check, test, build, ext:build.

Smoke against production: `BASE_URL=https://zerostash.jammutkarsh.workers.dev SECRET=$(grep ^ZEROSTASH_SECRET= .prod.vars | cut -d= -f2-) bun scripts/smoke.ts` (`.prod.vars` is gitignored; never print the secret).

## Deploying and releasing

- **Never deploy or apply remote migrations from a laptop.** Production deploys only through Cloudflare Workers Builds on push to `main`: build command `bun run build`, deploy command `bun run deploy`. `scripts/deploy.ts` refuses unless `WORKERS_CI=1`, applies D1 migrations **before** `wrangler deploy` (after it only on a fork's first deploy, when the database doesn't exist yet), and relies on the build step for `dist/`.
- `wrangler.jsonc` deliberately has no `database_id` (auto-provisioned) and no `routes` (so custom domains added in the dashboard survive deploys).
- Releasing: bump `version` in `package.json` on `main`, then tag that same commit `vX.Y.Z`. `release.yml` fails if tag ≠ package.json, then publishes a GitHub release with extension zips. That release is what forks' dashboards compare against for the "Update available" notice (`web/lib/update.ts`); forks update via GitHub "Sync fork".
- New schema change = new `migrations/000N_*.sql` file; never edit an applied migration.

## Architecture

**Request routing.** Static assets are free and don't invoke the Worker; `assets.run_worker_first: ["/api/*", "/privacy-policy"]` limits Worker invocations to the API. `@cloudflare/vite-plugin` runs both in one `vite dev`. `server/index.ts` exports `fetch` (Hono app), `scheduled` (single `*/5` cron: server OG fallback + tombstone purge) and a `queue` consumer reserved for future AI jobs.

**API contract and typed clients.**
- `server/routes.ts` holds every route contract (`createRoute` from `@hono/zod-openapi`) and must import only `@hono/zod-openapi` and `shared/schemas` — no Worker types — because the web app and extension type-import it. It ends with a handler-less chain (`.openapi(route, stub)`) that exports `ApiType`; hono/client response types come from the route's `responses`, not handlers.
- `server/app.ts` registers handlers with `app.openapi(r.X, handler)` plus middleware (CORS reflecting `chrome-extension://`/`moz-extension://` origins, auth guard, error handler). Order matters: `/bookmarks/needs-og` before `/bookmarks/{id}`.
- Adding a route: contract in `routes.ts` → append to the contract chain → handler in `app.ts`. Clients call `hc<ApiType>` and unwrap with `ok()` from `shared/http.ts` (throws `ApiError` with the server's `error` code).
- `scripts/openapi.ts` emits the spec as a static asset at build time (served free at `/openapi.json`, rendered at `/api-docs`).

**Auth.** Single owner, one secret `ZEROSTASH_SECRET` (≥32 chars, constant-time compared). Extension/scripts send `Authorization: Bearer`; the web UI exchanges it at `/api/v1/auth/login` for an HMAC-signed cookie. Without a valid secret the server reports `setupRequired` and the SPA shows a setup page.

**Data (D1).** Raw prepared statements and `db.batch()`, no ORM. Designed around Free-tier hard limits (10 ms CPU, 5M rows read/day, 100k rows written/day, 100 bound params per statement, 50 queries per invocation): index-backed cursor pagination, no `COUNT(*)`/`OFFSET`, no FTS5 (virtual tables break `wrangler d1 export`), list item counts maintained in the same batch as membership changes.

**Delta sync** (`GET /api/v1/changes?since=`). Returns bookmarks with `updated_at > since`, deleted ids from `tombstones`, and all lists. The cursor trails now by 60 s, so applying is idempotent; it returns `reset: true` on first call, when `since` is older than the 30-day tombstone TTL, or past 100 changes. **Every write that changes what a client shows must bump `bookmarks.updated_at`** (including list add/remove and list delete for its members), and deletes must insert a tombstone. The client (`web/lib/store.svelte.ts`) persists feeds in localStorage, renders from cache, and applies incoming items only if newer; searches and smart lists can't be evaluated from the delta and refetch their first page.

**OpenGraph previews.** The extension is the primary reader (the browser follows redirects, sends cookies, isn't IP-blocked): the popup reads the active tab, and the background service worker polls `needs-og` and fetches pages with the optional `<all_urls>` permission. The server cron only fills bookmarks still pending after a grace period. A lower-ranked source never overwrites a higher one — `OG_SOURCE_RANK` in `shared/og.ts` must mirror `OG_RANK_SQL`/`OG_RANK` in `server/bookmarks.ts`. `shared/og.ts` parses `<head>` without `DOMParser` (MV3 service workers lack it).

**Lists.** Manual (membership in `bookmark_lists`, counted) and smart (search terms stored as JSON in `lists.query`); nestable via `parent_id`.

**Web SPA** (`web/`). Svelte 5 runes + Tailwind 4, hand-rolled router (`web/lib/router.svelte.ts`): `/` is the marketing page unless a session hint exists, `/login`, `/dashboard/*`, `/api-docs`. Two tsconfigs: `tsconfig.json` (web + shared, DOM) and `tsconfig.worker.json` (server).

**Extension** (`extension/`). One codebase, two targets: `vite build --mode chrome|firefox` defines `__BROWSER_TARGET__`, then `scripts/generate-manifest.ts` writes the per-browser manifest (version taken from the root `package.json`). Settings live in `chrome.storage.local`. The service worker registers a content script (`bridge.ts`) on the user's server origin to relay the web app's `zerostash:saved` event so previews are fetched within seconds.

## Conventions

- Karakeep and Cloudmark are AGPL: reimplement, never copy their code, prompts, icons or screenshots.
- `ponytail:` comments mark deliberate simplifications with a known ceiling and upgrade path; keep them accurate when touching that code.
- Project skills in `.claude/skills/` cover delta-sync changes (`zerostash-delta-sync`) and adding API routes / typed client calls (`zerostash-typed-api-client`).
