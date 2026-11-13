// Local twin of the server's search (server/domain/search.ts), so search and smart lists run
// against the offline copy. server/domain/search.test.ts runs the same cases through both.
import { fold, type Query } from '../../shared/query';
import type { Bookmark, List } from '../../shared/schemas';

export interface MatchContext {
	now: number;
	listName: (id: string) => string | undefined;
	feedName: (id: string) => string | undefined;
}

// Bookmarks are replaced, never mutated, so the folded text can be cached per object.
const hay = new WeakMap<Bookmark, string>();

/** Same fields, same order and the same newline joins as the server's HAYSTACK. */
function haystack(b: Bookmark): string {
	let h = hay.get(b);
	if (h === undefined) {
		const c = b.content;
		const link = c.type === 'link' ? c : undefined;
		h = fold(
			[
				b.title,
				link?.title,
				link?.url,
				link?.description,
				link?.publisher,
				link?.author,
				b.note,
				c.type === 'text' ? c.text : null,
				b.summary,
				c.type === 'asset' ? c.fileName : null,
				b.tags.map((t) => t.name).join('\n'),
			]
				.map((v) => v ?? '')
				.join('\n'),
		);
		hay.set(b, h);
	}
	return h;
}

const has = (text: string | null | undefined, v: string) => fold(text ?? '').includes(fold(v));
const same = (a: string | undefined, b: string) => a !== undefined && fold(a) === fold(b);

export function queryPredicate(q: Query, ctx: MatchContext): (b: Bookmark) => boolean {
	switch (q.k) {
		case 'all':
			return () => true;
		case 'and': {
			const ps = q.of.map((n) => queryPredicate(n, ctx));
			return (b) => ps.every((p) => p(b));
		}
		case 'or': {
			const ps = q.of.map((n) => queryPredicate(n, ctx));
			return (b) => ps.some((p) => p(b));
		}
		case 'not': {
			const p = queryPredicate(q.of, ctx);
			return (b) => !p(b);
		}
		case 'text': {
			const v = fold(q.v);
			return (b) => haystack(b).includes(v);
		}
		case 'is':
			switch (q.v) {
				case 'fav':
					return (b) => b.favourited;
				case 'archived':
					return (b) => b.archived;
				case 'tagged':
					return (b) => b.tags.length > 0;
				case 'inlist':
					return (b) => b.listIds.length > 0;
				case 'link':
				case 'text':
					return (b) => b.content.type === q.v;
				case 'media':
					return (b) => b.content.type === 'asset';
				case 'broken':
					return (b) => b.content.type === 'link' && b.content.crawlStatus === 'failure';
			}
		// falls through (unreachable)
		case 'has':
			return q.v === 'notes' ? (b) => !!b.note : () => false;
		case 'url':
			return (b) => has(b.content.type === 'link' ? b.content.url : b.content.sourceUrl, q.v);
		case 'title':
			return (b) =>
				has([b.title, b.content.type === 'link' ? b.content.title : null, b.content.type === 'asset' ? b.content.fileName : null].map((v) => v ?? '').join('\n'), q.v);
		case 'tag':
			return (b) => b.tags.some((t) => same(t.name, q.v));
		case 'list':
			return (b) => b.listIds.some((id) => same(ctx.listName(id), q.v));
		case 'feed':
			return (b) => !!b.feedId && same(ctx.feedName(b.feedId), q.v);
		case 'source':
			return (b) => (b.source ?? '') === q.v;
		case 'after':
			return (b) => b.createdAt.getTime() >= q.v;
		case 'before':
			return (b) => b.createdAt.getTime() < q.v;
		case 'age': {
			const edge = ctx.now - q.ms;
			return q.op === '<' ? (b) => b.createdAt.getTime() > edge : (b) => b.createdAt.getTime() < edge;
		}
	}
}

/** A list's bookmarks: its members, plus (smart lists) everything its query matches. */
export function listPredicate(list: Pick<List, 'id' | 'type'> & { parsed: Query | null }, ctx: MatchContext): (b: Bookmark) => boolean {
	const q = list.type === 'smart' && list.parsed ? queryPredicate(list.parsed, ctx) : () => false;
	return (b) => b.listIds.includes(list.id) || q(b);
}

/** Newest first, ties by id: the server's ORDER BY created_at DESC, id DESC. */
export const byNewest = (a: Bookmark, b: Bookmark) =>
	b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
