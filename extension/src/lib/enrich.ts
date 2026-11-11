// Background OpenGraph enrichment — the primary OG path for links not saved from an
// open tab. Fetching from the browser follows redirects, carries the user's cookies and
// isn't blocked like datacenter IPs. The server's cron only fills what this misses.
import { isPrivateHost, parseOg, readHead } from '../../../shared/og';
import { server } from './api';
import { ogFields } from './save';
import { ALL_URLS, getSettings, isConfigured } from './settings';

let running: Promise<number> | null = null;

/** Returns how many previews were filled. Never runs twice at once. */
export function enrich(): Promise<number> {
	running ??= run().finally(() => (running = null));
	return running;
}

async function run(): Promise<number> {
	if (!isConfigured(await getSettings())) return 0;
	if (!(await chrome.permissions.contains(ALL_URLS))) return 0;
	const { items } = await server.needsOg();
	let filled = 0;
	for (const { id, url } of items) {
		try {
			if (isPrivateHost(url)) throw new Error('private host');
			// ponytail: cookies are sent so login-walled pages resolve; before imports/RSS feed
			// untrusted URLs in here, send cookies only for links the user saved themselves.
			const res = await fetch(url, { redirect: 'follow', credentials: 'include', signal: AbortSignal.timeout(10_000) });
			if (isPrivateHost(res.url)) throw new Error('redirected to a private host');
			if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) throw new Error(`HTTP ${res.status}`);
			const og = ogFields(parseOg(await readHead(res), res.url || url));
			if (!og.title && !og.description && !og.imageUrl) throw new Error('no metadata');
			await server.putOg(id, { source: 'extension', ...og });
			filled++;
		} catch {
			await server.putOg(id, { source: 'extension', failed: true }).catch(() => {});
		}
	}
	return filled;
}
