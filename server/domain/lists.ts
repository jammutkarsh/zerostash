// Lists: manual (explicit membership, counted) and smart (a saved search query; bookmarks
// added by hand belong too). The lists table is tiny, so reading all of it is fine;
// membership changes update item_count in the same batch, so counts never need a COUNT(*).
import { parseQuery } from '../../shared/query';
import type { EditList, List, NewListInput } from '../../shared/schemas';
import { type BookmarkFilter, countBookmarks } from './bookmarks';
import { DomainError, notFound } from './util';

interface Row {
	id: string;
	name: string;
	description: string | null;
	icon: string;
	parent_id: string | null;
	type: 'manual' | 'smart';
	query: string | null;
	item_count: number;
	created_at: number;
}

const toList = (r: Row): List => ({
	id: r.id,
	name: r.name,
	description: r.description,
	icon: r.icon,
	parentId: r.parent_id,
	type: r.type,
	query: r.query,
	public: false,
	hasCollaborators: false,
	userRole: 'owner',
});

export async function allLists(db: D1Database): Promise<List[]> {
	const { results } = await db.prepare('SELECT * FROM lists ORDER BY name COLLATE NOCASE').all<Row>();
	return results.map(toList);
}

export async function getList(db: D1Database, id: string): Promise<List> {
	const row = await db.prepare('SELECT * FROM lists WHERE id = ?').bind(id).first<Row>();
	if (!row) throw notFound('List');
	return toList(row);
}

/** The filter that selects a list's bookmarks. */
export const listFilter = (l: List): BookmarkFilter['list'] => ({ id: l.id, type: l.type, query: l.query ? parseQuery(l.query) : null });

/** A list can't become its own ancestor. */
async function assertParent(db: D1Database, id: string | null, parentId: string | null | undefined) {
	if (!parentId) return;
	const byId = new Map((await allLists(db)).map((l) => [l.id, l]));
	if (!byId.has(parentId)) throw new DomainError('BAD_REQUEST', 'Parent list not found.');
	for (let cur: string | null = parentId; cur; cur = byId.get(cur)?.parentId ?? null) {
		if (cur === id) throw new DomainError('BAD_REQUEST', "A list can't be inside itself.");
	}
}

export async function createList(db: D1Database, input: NewListInput, now = Date.now()): Promise<List> {
	await assertParent(db, null, input.parentId);
	const id = crypto.randomUUID();
	await db
		.prepare('INSERT INTO lists (id, name, description, icon, parent_id, type, query, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(id, input.name, input.description || null, input.icon, input.parentId || null, input.type, input.type === 'smart' ? input.query! : null, now)
		.run();
	return getList(db, id);
}

export async function editList(db: D1Database, patch: EditList): Promise<List> {
	const list = await getList(db, patch.listId);
	if (patch.parentId !== undefined) await assertParent(db, list.id, patch.parentId);
	if (patch.query !== undefined && list.type !== 'smart') throw new DomainError('BAD_REQUEST', 'Only smart lists have a query.');
	const sets: string[] = [];
	const values: (string | null)[] = [];
	if (patch.name !== undefined) sets.push('name = ?'), values.push(patch.name);
	if (patch.description !== undefined) sets.push('description = ?'), values.push(patch.description || null);
	if (patch.icon !== undefined) sets.push('icon = ?'), values.push(patch.icon);
	if (patch.parentId !== undefined) sets.push('parent_id = ?'), values.push(patch.parentId || null);
	if (patch.query !== undefined) sets.push('query = ?'), values.push(patch.query);
	if (sets.length) await db.prepare(`UPDATE lists SET ${sets.join(', ')} WHERE id = ?`).bind(...values, list.id).run();
	return getList(db, list.id);
}

/** Deletes the list (never its bookmarks). Child lists move to the top level, or go too with `deleteChildren`. */
export async function deleteList(db: D1Database, id: string, deleteChildren = false, now = Date.now()): Promise<void> {
	const lists = await allLists(db);
	if (!lists.some((l) => l.id === id)) throw notFound('List');
	const doomed = [id];
	if (deleteChildren) {
		for (let i = 0; i < doomed.length; i++) for (const l of lists) if (l.parentId === doomed[i]) doomed.push(l.id);
	}
	await db.batch(
		doomed.flatMap((listId) => [
			// Members' listIds change: bump them so other devices pick that up (delta sync).
			db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id IN (SELECT bookmark_id FROM bookmarks_in_lists WHERE list_id = ?)').bind(now, listId),
			db.prepare('UPDATE lists SET parent_id = NULL WHERE parent_id = ?').bind(listId),
			db.prepare('DELETE FROM lists WHERE id = ?').bind(listId),
		]),
	);
}

/**
 * Idempotent. `changes()` moves the count only when a row really changed, so it must directly
 * follow the membership write. Bumping updated_at puts the new listIds into delta sync.
 */
export async function addToList(db: D1Database, listId: string, bookmarkId: string, now = Date.now()): Promise<void> {
	await getList(db, listId);
	if (!(await db.prepare('SELECT 1 FROM bookmarks WHERE id = ?').bind(bookmarkId).first())) throw notFound('Bookmark');
	await db.batch([
		db.prepare('INSERT OR IGNORE INTO bookmarks_in_lists (bookmark_id, list_id) VALUES (?, ?)').bind(bookmarkId, listId),
		db.prepare('UPDATE lists SET item_count = item_count + changes() WHERE id = ?').bind(listId),
		db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').bind(now, bookmarkId),
	]);
}

export async function removeFromList(db: D1Database, listId: string, bookmarkId: string, now = Date.now()): Promise<void> {
	await getList(db, listId);
	await db.batch([
		db.prepare('DELETE FROM bookmarks_in_lists WHERE bookmark_id = ? AND list_id = ?').bind(bookmarkId, listId),
		db.prepare('UPDATE lists SET item_count = item_count - changes() WHERE id = ?').bind(listId),
		db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').bind(now, bookmarkId),
	]);
}

/** Bookmarks per list: manual lists from the kept count, smart lists by running their query. */
export async function listSizes(db: D1Database, now = Date.now()): Promise<Map<string, number>> {
	const { results } = await db.prepare('SELECT * FROM lists').all<Row>();
	const sizes = await Promise.all(
		results.map(async (r) => [r.id, r.type === 'manual' ? r.item_count : await countBookmarks(db, { list: listFilter(toList(r)) }, now)] as const),
	);
	return new Map(sizes);
}
