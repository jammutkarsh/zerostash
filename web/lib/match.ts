import type { Bookmark } from '../../shared/schemas';

// Local twin of the server's search (server/bookmarks.ts SEARCH_COLUMNS + LIKE '%term%'):
// a term matches when it appears anywhere in one of these fields, ignoring case.
const FIELDS = ['title', 'url', 'description', 'siteName', 'note', 'text', 'summary'] as const;

// Bookmarks are replaced, never mutated, so the lowercased text can be cached per object.
const hay = new WeakMap<Bookmark, string>();

function haystack(b: Bookmark): string {
	let h = hay.get(b);
	if (h === undefined) {
		// A newline can't appear in a search term, so joining never creates cross-field matches.
		h = FIELDS.map((f) => b[f] ?? '').join('\n').toLowerCase();
		hay.set(b, h);
	}
	return h;
}

export function matches(b: Bookmark, terms: string[]): boolean {
	return terms.some((t) => {
		const term = t.trim().toLowerCase();
		return !!term && haystack(b).includes(term);
	});
}

/**
 * What a view shows, newest first, mirroring server/bookmarks.ts listBookmarks: search and
 * lists span archived bookmarks too; a smart list is its hand-added members plus term matches.
 */
export function select(
	all: Bookmark[],
	o: { view: 'home' | 'favourites' | 'archive'; q?: string; list?: { id: string; kind: 'manual' | 'smart'; terms: string[] } },
): Bookmark[] {
	const { q, list } = o;
	if (q) return all.filter((b) => matches(b, [q]));
	if (list) return all.filter((b) => b.listIds.includes(list.id) || (list.kind === 'smart' && matches(b, list.terms)));
	if (o.view === 'favourites') return all.filter((b) => b.favourited);
	return all.filter((b) => b.archived === (o.view === 'archive'));
}

/** Newest first, ties by id: the server's ORDER BY created_at DESC, id DESC. */
export const byNewest = (a: Bookmark, b: Bookmark) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
