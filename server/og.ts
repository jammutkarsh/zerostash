// Link previews (OpenGraph). The server is the only reader: every new link is fetched right
// away (waitUntil), and the cron retries the ones whose fetch failed.
import { isPrivateHost, parseOg, readHead } from '../shared/og';
import { applyCrawl, markCrawlFailed, pendingCrawls } from './domain/bookmarks';
import { emit } from './events';
import type { Ctx } from './service';

// ponytail: 5 retries per cron run keeps <head> parsing inside the Free plan's 10 ms CPU and
// well under 50 subrequests (redirects count). Raise on Workers Paid.
const CRAWL_BATCH = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; Zerostash/1.0; link preview; +https://github.com/jammutkarsh/zerostash)';

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

export async function crawl(ctx: Ctx, id: string, url: string): Promise<void> {
	try {
		await applyCrawl(ctx.env.DB, id, await fetchOg(url));
		await emit(ctx, [{ bookmarkId: id, webhook: 'crawled' }]);
	} catch (err) {
		console.log(JSON.stringify({ msg: 'crawl failed', id, error: String(err) }));
		await markCrawlFailed(ctx.env.DB, id);
	}
}

export async function crawlBacklog(ctx: Ctx, now = Date.now()): Promise<void> {
	const todo = await pendingCrawls(ctx.env.DB, CRAWL_BATCH, now);
	await Promise.all(todo.map(({ id, url }) => crawl(ctx, id, url)));
}
