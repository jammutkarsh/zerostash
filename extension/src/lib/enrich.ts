// Background previews: links the server couldn't read (bot walls, logins, datacenter IP blocks)
// are fetched from the user's browser, which follows redirects and carries their cookies, then
// sent back. The server tries first (right after saving, retried by its cron); this fills the gaps.
import { isPrivateHost, parseOg, readHead } from '../../../shared/og';
import { api } from './api';
import { previewOf } from './save';
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
	const client = await api();
	const { items } = await client.zerostash.previewsNeeded.query({ limit: 20 });
	let filled = 0;
	for (const { id, url } of items) {
		try {
			if (isPrivateHost(url)) throw new Error('private host');
			// ponytail: cookies are sent so login-walled pages resolve; feed items are offered too,
			// which only ever means a GET of a public article with the user's cookies for that site.
			const res = await fetch(url, { redirect: 'follow', credentials: 'include', signal: AbortSignal.timeout(10_000) });
			if (isPrivateHost(res.url)) throw new Error('redirected to a private host');
			if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) throw new Error(`HTTP ${res.status}`);
			const og = previewOf(parseOg(await readHead(res), res.url || url));
			if (!og.title && !og.description && !og.imageUrl) throw new Error('no metadata');
			await client.zerostash.setPreview.mutate({ bookmarkId: id, og });
			filled++;
		} catch {
			await client.zerostash.setPreview.mutate({ bookmarkId: id, og: null }).catch(() => {});
		}
	}
	return filled;
}
