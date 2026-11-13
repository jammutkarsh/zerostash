// Query AST (shared/query.ts) -> SQL WHERE clause over `bookmarks b`. Must agree with the
// web app's predicate (web/lib/match.ts); search.test.ts runs the same cases through both.
// ponytail: LIKE over a concatenated haystack = a full scan per search (~1 row read per
// bookmark, plus its tags). Fine at personal scale; FTS would need a non-virtual index table.
import type { Query } from '../../shared/query';
import { contains, DomainError } from './util';

// Newline-joined, so a term can never match across two fields.
const col = (c: string) => `coalesce(${c}, '')`;
const TAG_NAMES = `(SELECT group_concat(t.name, char(10)) FROM tags_on_bookmarks tb JOIN tags t ON t.id = tb.tag_id WHERE tb.bookmark_id = b.id)`;
export const HAYSTACK = [
	'b.title',
	'b.link_title',
	'b.url',
	'b.description',
	'b.publisher',
	'b.author',
	'b.note',
	'b.text',
	'b.summary',
	'b.file_name',
	TAG_NAMES,
]
	.map(col)
	.join(` || char(10) || `);
const TITLE = ['b.title', 'b.link_title', 'b.file_name'].map(col).join(` || char(10) || `);

const IS_SQL = {
	fav: 'b.favourited = 1',
	archived: 'b.archived = 1',
	tagged: 'EXISTS (SELECT 1 FROM tags_on_bookmarks WHERE bookmark_id = b.id)',
	inlist: 'EXISTS (SELECT 1 FROM bookmarks_in_lists WHERE bookmark_id = b.id)',
	link: `b.type = 'link'`,
	text: `b.type = 'text'`,
	media: `b.type = 'asset'`,
	broken: `coalesce(b.crawl_status, '') = 'failure'`,
} as const;

const MAX_PARAMS = 80; // D1 allows 100 bound parameters per statement; leave room for paging

/** Every branch yields TRUE or FALSE, never NULL, so NOT behaves like the JS predicate. */
export function querySql(q: Query, now: number): { sql: string; params: (string | number)[] } {
	const params: (string | number)[] = [];
	const walk = (n: Query): string => {
		switch (n.k) {
			case 'all':
				return '1';
			case 'and':
			case 'or':
				return `(${n.of.map(walk).join(n.k === 'and' ? ' AND ' : ' OR ')})`;
			case 'not':
				return `NOT (${walk(n.of)})`;
			case 'text':
				params.push(contains(n.v));
				return `(${HAYSTACK} LIKE ? ESCAPE '\\')`;
			case 'is':
				return IS_SQL[n.v];
			case 'has':
				return n.v === 'notes' ? `coalesce(b.note, '') <> ''` : '0';
			case 'url':
				params.push(contains(n.v));
				return `(coalesce(b.url, b.source_url, '') LIKE ? ESCAPE '\\')`;
			case 'title':
				params.push(contains(n.v));
				return `(${TITLE} LIKE ? ESCAPE '\\')`;
			case 'tag':
				params.push(n.v);
				return 'EXISTS (SELECT 1 FROM tags_on_bookmarks tb JOIN tags t ON t.id = tb.tag_id WHERE tb.bookmark_id = b.id AND t.name = ?)';
			case 'list':
				params.push(n.v);
				return 'EXISTS (SELECT 1 FROM bookmarks_in_lists bl JOIN lists l ON l.id = bl.list_id WHERE bl.bookmark_id = b.id AND l.name = ? COLLATE NOCASE)';
			case 'feed':
				params.push(n.v);
				return 'EXISTS (SELECT 1 FROM feeds f WHERE f.id = b.feed_id AND f.name = ? COLLATE NOCASE)';
			case 'source':
				params.push(n.v);
				return `coalesce(b.source, '') = ?`;
			case 'after':
				params.push(n.v);
				return 'b.created_at >= ?';
			case 'before':
				params.push(n.v);
				return 'b.created_at < ?';
			case 'age':
				params.push(now - n.ms);
				return n.op === '<' ? 'b.created_at > ?' : 'b.created_at < ?';
		}
	};
	const sql = walk(q);
	if (params.length > MAX_PARAMS) throw new DomainError('BAD_REQUEST', 'Search query is too long.');
	return { sql, params };
}
