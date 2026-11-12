// Production deploy (`bun run deploy`). Runs only on Cloudflare Workers Builds, which sets
// WORKERS_CI=1 and runs this on every push to the production branch, after its build command
// (`bun run build`) has produced dist/ — without it `wrangler deploy` fails. Migrations are applied
// here and nowhere else, before the new code goes live: a deploy from a laptop once shipped
// code without its migration and broke deletes in production.
import { $ } from 'bun';

if (process.env.WORKERS_CI !== '1') {
	console.error('Deploys run on Cloudflare Workers Builds only: push to main. See docs/deployment/workers.md.');
	process.exit(1);
}

// A fork's first deploy has no database yet; `wrangler deploy` creates it, so migrate after.
// Any other reason `d1 info` fails stops the deploy.
// ponytail: matches Wrangler's error text; if it changes, a fork's first build fails loudly.
const info = await $`bunx wrangler d1 info DB`.quiet().nothrow();
const firstDeploy = info.exitCode !== 0;
if (firstDeploy && !`${info.stdout}${info.stderr}`.includes("Couldn't find a D1 DB")) {
	console.error(`${info.stdout}${info.stderr}`);
	process.exit(1);
}

if (!firstDeploy) await $`bunx wrangler d1 migrations apply DB --remote`; // fails = no deploy
await $`bunx wrangler deploy`;
if (firstDeploy) await $`bunx wrangler d1 migrations apply DB --remote`;
