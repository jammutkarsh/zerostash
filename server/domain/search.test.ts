// The same queries through both evaluators — SQL (server) and the web app's predicate — on
// the same bookmarks, checked against the expected answer.
import { expect, test } from 'bun:test';
import { parseQuery } from '../../shared/query';
import { NewBookmark, NewList, type Bookmark } from '../../shared/schemas';
import { queryPredicate } from '../../web/lib/match';
import { testDb } from '../test/d1';
import { applyCrawl, createBookmark, listBookmarks, markCrawlFailed, updateBookmark } from './bookmarks';
import { addToList, allLists, createList } from './lists';
import { updateTags } from './tags';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 13);

async function fixture() {
	const db = testDb();
	const add = async (input: Parameters<typeof NewBookmark.parse>[0]) => (await createBookmark(db, NewBookmark.parse(input), NOW)).bookmark.id;
	const ids = {
		pg: await add({ type: 'link', url: 'https://planetscale.com/blog/postgres', title: 'Postgres at scale', createdAt: new Date(NOW - 2 * DAY) }),
		go: await add({ type: 'link', url: 'https://go.dev/blog/pipelines', favourited: true, createdAt: new Date(NOW - 40 * DAY) }),
		note: await add({ type: 'text', text: 'Remember: GOLANG channels', note: 'from a talk', source: 'mobile', createdAt: new Date(Date.UTC(2026, 0, 2, 12)) }),
		old: await add({ type: 'link', url: 'https://example.com/ünïcode', archived: true, createdAt: new Date(NOW - 400 * DAY) }),
	};
	await applyCrawl(db, ids.go, { title: 'Go Concurrency Patterns', description: 'Pipelines and cancellation' }, NOW);
	for (let i = 0; i < 3; i++) await markCrawlFailed(db, ids.old, NOW);
	await updateTags(db, ids.go, [{ tagName: 'Go' }, { tagName: 'concurrency', attachedBy: 'ai' }], [], NOW);
	await updateTags(db, ids.pg, [{ tagName: 'databases' }], [], NOW);
	const list = await createList(db, NewList.parse({ name: 'Read Later', icon: '📚' }), NOW);
	await addToList(db, list.id, ids.note, NOW);
	await updateBookmark(db, { bookmarkId: ids.pg, note: '100% worth it' }, NOW);
	return { db, ids };
}

const CASES: [string, (keyof Awaited<ReturnType<typeof fixture>>['ids'])[]][] = [
	['', ['pg', 'go', 'note', 'old']],
	['postgres', ['pg']],
	['POSTGRES', ['pg']],
	['golang', ['note']],
	['go', ['go', 'note']], // go.dev + tag Go, and GOLANG; nothing in pg/old
	['pipelines cancellation', ['go']],
	['"concurrency patterns"', ['go']],
	['concurrency', ['go']], // AI tag + title
	['100%', ['pg']], // LIKE wildcards are literal
	['100_', []],
	['is:fav', ['go']],
	['-is:fav', ['pg', 'note', 'old']],
	['is:archived', ['old']],
	['is:tagged', ['pg', 'go']],
	['is:inlist', ['note']],
	['is:link', ['pg', 'go', 'old']],
	['is:text', ['note']],
	['is:media', []],
	['is:broken', ['old']],
	['-is:broken', ['pg', 'go', 'note']], // text bookmarks have no crawl status: NOT must still match them
	['has:notes', ['pg', 'note']],
	['-has:notes', ['go', 'old']],
	['has:highlights', []],
	['#go', ['go']],
	['#GO', ['go']],
	['tag:databases', ['pg']],
	['#nope', []],
	['list:"read later"', ['note']],
	['url:go.dev', ['go']],
	['url:ünïcode', ['old']],
	['title:postgres', ['pg']],
	['title:concurrency', ['go']],
	['source:mobile', ['note']],
	['after:2026-11-01', ['pg']],
	['before:2026-01-02', ['note', 'old']], // on or before that day
	['before:2026-01-02 or after:2026-11-11', ['pg', 'note', 'old']],
	['age:<7d', ['pg']],
	['age:>1y', ['old']],
	['is:link -is:archived -#go', ['pg']],
	['(#go or #databases) and -is:fav', ['pg']],
	['feed:anything', []],
];

test('SQL and web predicate agree with the expected results', async () => {
	const { db, ids } = await fixture();
	const all = (await listBookmarks(db, {}, { limit: 100 }, NOW)).bookmarks;
	const lists = await allLists(db);
	const ctx = { now: NOW, listName: (id: string) => lists.find((l) => l.id === id)?.name, feedName: () => undefined };
	const nameOf = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
	const names = (bs: Bookmark[]) => bs.map((b) => nameOf.get(b.id));

	for (const [q, expected] of CASES) {
		const parsed = parseQuery(q);
		const sql = names((await listBookmarks(db, { query: parsed }, { limit: 100 }, NOW)).bookmarks);
		const js = names(all.filter(queryPredicate(parsed, ctx)));
		expect({ q, sql }).toEqual({ q, sql: expected });
		expect({ q, js }).toEqual({ q, js: expected });
	}
});
