# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Zerostash: bookmarks that run entirely on Cloudflare's **free tier** — one Worker (Hono + tRPC + REST, static Svelte SPA) with D1, R2, a Queue, Workers AI and a cron. It speaks **Karakeep's API**, so Karakeep's browser extension, mobile apps, CLI and MCP server work against it; the Zerostash web app uses the same API. Single owner. There is no Zerostash extension any more.

## Commands

```sh
bun install
cp .dev.vars.example .dev.vars          # set ZEROSTASH_SECRET (≥32 chars); ZEROSTASH_AI=off keeps dev offline
bun run db:migrate:local                # apply migrations/ to local D1
bun run dev                             # SPA + Worker together on http://localhost:5173

bun run check                           # svelte-check (web+shared) + tsc (server, tsconfig.worker.json)
bun run test                            # bun test over shared/ server/ web/ (D1 = bun:sqlite stand-in)
bun test server/domain/search.test.ts   # one file;  bun test -t "name" for one test
bun run smoke                           # end-to-end over tRPC (Karakeep's client stack) + REST; needs `bun run dev`
bun run types                           # regenerate server/worker-configuration.d.ts after editing wrangler.jsonc
bun run build                           # writes public/openapi.json, then vite build
```

CI (`.github/workflows/ci.yml`) runs: types, check, test, build.

Smoke against production: `BASE_URL=https://zerostash.jammutkarsh.workers.dev SECRET=$(grep ^ZEROSTASH_SECRET= .prod.vars | cut -d= -f2-) bun scripts/smoke.ts` (`.prod.vars` is gitignored; never print the secret). Smoke creates and deletes its own data, and subscribes to one real RSS feed.

## Deploying and releasing

- **Never deploy or apply remote migrations from a laptop.** Production deploys only through Cloudflare Workers Builds on push to `main`: build `bun run build`, deploy `bun run deploy`. `scripts/deploy.ts` refuses unless `WORKERS_CI=1`, applies D1 migrations **before** `wrangler deploy` (after it only on a first deploy, when the database doesn't exist yet).
- `wrangler.jsonc` deliberately has no `database_id` / bucket ids (auto-provisioned) and no `routes` (custom domains added in the dashboard survive deploys). Gotcha: if a deployed Worker's D1 binding points at a deleted database, Wrangler's provisioning fails the deploy; delete the Worker (after removing it as the queue's consumer) or rename the binding.
- Releasing: bump `version` in `package.json` on `main`, then tag that commit `vX.Y.Z`. `release.yml` fails if tag ≠ package.json, then publishes a GitHub release; forks' dashboards compare against it (`web/lib/update.ts`).
- New schema change = new `migrations/000N_*.sql`; never edit an applied migration. (1.0 restarted from `0001_init.sql`; 0.x databases must be recreated, see `docs/deployment/upgrading.md`.)

## Architecture

**One domain layer, two protocol adapters.** `server/domain/*` holds all D1/R2 logic and returns Karakeep-shaped objects. `server/service.ts` wraps writes with their side effects (crawl, AI queueing, file cleanup, events). Adapters stay thin:
- `server/trpc.ts` — tRPC + superjson at `/api/trpc`, **Karakeep's procedure names and shapes** (what Karakeep's extension and mobile app speak), plus a `zerostash.*` namespace (delta sync, status) for the web app. Unimplemented Karakeep procedures return tRPC NOT_FOUND; a few the mobile app calls at startup return empty-safe values (highlights, invitations).
- `server/rest.ts` — Karakeep's REST API at `/api/v1` via `@hono/zod-openapi`; `scripts/openapi.ts` emits the spec at build time (`/openapi.json`, rendered at `/api-docs`).
- `server/app.ts` — Hono: CORS (extension origins only), `/api/health`, `/api/auth/login|logout` (web cookie), `/api/assets` (R2 upload/serve, outside `/api/v1` because Karakeep's clients use that path), mounts both APIs.
- Adding an endpoint: domain function → service wrapper if it has side effects → tRPC procedure and/or REST route. Shapes/validation live in `shared/schemas.ts` (our own definitions with Karakeep's field names). Reimplement from Karakeep's wire contract only; never copy Karakeep code, prompts or schemas (AGPL).

**Auth.** Single owner, one secret `ZEROSTASH_SECRET` (≥32 chars, constant-time compared). Bearer secret (Karakeep clients, scripts) or the HMAC session cookie (web). Karakeep's `apiKeys.exchange` (any email + secret as password) and `apiKeys.validate` resolve to the same secret. `trpc.ts` gets secret checks through its context, so the web's type import of `AppRouter` doesn't pull in `auth.ts`.

**Web type-imports the server.** `web/lib/api.ts` uses `createTRPCClient<AppRouter>`, which brings server files into the DOM program; `web/worker-globals.d.ts` stands in for the few Worker globals they name. When server code reachable from `trpc.ts` starts using a new binding or global, add it there (tsconfig.worker.json still checks against the real types).

**Data (D1).** `migrations/0001_init.sql`. Raw prepared statements and `db.batch()`, no ORM. Free-tier hard limits drive the design (10 ms CPU, 5M rows read/day, 100k rows written/day, 100 bound params per statement, 50 queries per invocation): one bookmarks table for all types, index-backed cursor pagination, no `COUNT(*)`/`OFFSET` (except smart-list sizes and stats), no FTS5, tag and list counts maintained in the same batch as membership changes, set-based tag updates (a call is ~10 statements whatever it touches). Tests run the real migrations on bun:sqlite (`server/test/d1.ts`).

**Query language** (`shared/query.ts`): Karakeep's search syntax parsed to an AST, used by search and smart lists. Two evaluators that must agree — SQL (`server/domain/search.ts`) and the web's predicate (`web/lib/match.ts`); `server/domain/search.test.ts` runs the same cases through both. Change both together. Case folding is ASCII-only everywhere (`fold`), matching SQLite's LIKE/NOCASE.

**Delta sync** (`zerostash.changes`). Bookmarks with `updated_at > since`, tombstoned ids, all lists and tags. The cursor trails now by 60 s; `reset: true` on first call, when `since` is older than the 30-day tombstone TTL, or past 100 changes. **Every write that changes what a client shows must bump `bookmarks.updated_at`** (tags, lists, assets, AI results included), and deletes must insert a tombstone. The web store (`web/lib/store.svelte.ts`) keeps the whole library in IndexedDB and computes views, search and smart lists locally.

**Background work.** One queue (`zerostash-jobs`, `max_batch_size: 1` so each job gets a whole invocation's CPU/query budget) for AI, rules, webhooks and feed fetches (`server/jobs.ts`). `server/events.ts` turns writes into rule/webhook jobs only when something listens. Rule actions never emit events (no loops). The `*/5` cron retries link previews, queues due RSS feeds (hourly each), purges tombstones and sweeps unclaimed uploads.

**Link previews.** The server fetches OpenGraph right after a link is saved (`waitUntil`), the cron retries failures up to 3 times. `bookmark.title` is the user's/client's title; `content.title` the page's.

**AI** (`server/ai.ts`). Provider chain, first key wins, defaults are each vendor's cheap-but-smart tier: `ANTHROPIC_API_KEY` (Anthropic SDK, `claude-sonnet-5-5`, structured output, server-side refusal fallback) → `OPENAI_API_KEY` (`gpt-6.1-terra`) → `GEMINI_API_KEY` (`gemini-3.8-flash` via Google's OpenAI-compatible API) → `AI_API_KEY`+`AI_BASE_URL`+`AI_MODEL` (any OpenAI-compatible API, no default) → Workers AI (`@cf/google/gemma-4-26b-a4b-it`; its catalog churns — error 5028 means pick a current model). `AI_MODEL` overrides any provider's default. Page text via `env.AI.toMarkdown`. `ZEROSTASH_AI=off` disables it; Karakeep's user settings (auto-tagging/summaries, tag style, curated tags) apply.

**Web SPA** (`web/`). Svelte 5 runes + Tailwind 4, hand-rolled router (`web/lib/router.svelte.ts`): `/` marketing page unless a session hint exists, `/login`, `/dashboard/*` (incl. `/dashboard/tags`, `/dashboard/settings`), `/api-docs`.

## Conventions

- Karakeep and Cloudmark are AGPL: reimplement, never copy their code, prompts, icons or screenshots.
- `ponytail:` comments mark deliberate simplifications with a known ceiling and upgrade path; keep them accurate when touching that code.
- Project skills in `.claude/skills/` cover delta-sync changes (`zerostash-delta-sync`) and adding API routes / typed client calls (`zerostash-typed-api-client`).
