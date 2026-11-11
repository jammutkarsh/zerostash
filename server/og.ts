// Server-side OpenGraph fallback, run by the cron. The extension is the primary OG
// reader (browser follows redirects, carries cookies, isn't IP-blocked); this only
// fills bookmarks the extension hasn't reached after OG_SERVER_GRACE_MS.
import { isPrivateHost, parseOg, readHead } from '../shared/og';
import { applyOg, markOgFailed, pendingForServerOg } from './bookmarks';

// ponytail: 5 pages per run keeps <head> parsing inside the Free plan's 10 ms CPU and
// well under 50 subrequests (redirects count). Raise on Workers Paid.
const SERVER_OG_BATCH = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; Zerostash/0.1; link preview; +https://github.com/jammutkarsh/zerostash)';

export async function fetchOg(url: string) {
	if (isPrivateHost(url)) throw new Error('private host');
	const res = await fetch(url, {
		redirect: 'follow',
		signal: AbortSignal.timeout(10_000),
		headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	if (!(res.headers.get('content-type') ?? '').includes('html')) {
		await res.body?.cancel();
		throw new Error('not html');
	}
	const og = parseOg(await readHead(res), res.url || url);
	if (!og.title && !og.description && !og.imageUrl) throw new Error('no metadata');
	return og;
}

export async function serverOgFallback(db: D1Database, now = Date.now()): Promise<void> {
	const todo = await pendingForServerOg(db, SERVER_OG_BATCH, now);
	await Promise.all(
		todo.map(async ({ id, url }) => {
			try {
				await applyOg(db, id, await fetchOg(url), 'server', now);
			} catch (err) {
				console.log(JSON.stringify({ msg: 'server og failed', id, error: String(err) }));
				await markOgFailed(db, id, 'server', now);
			}
		}),
	);
}
