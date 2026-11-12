// Lists: manual (explicit membership, counted) and smart (a saved search).
// The lists table is tiny, so reading all of it is fine; membership changes update
// item_count in the same batch so counts never need a COUNT(*).
import type { CreateList, List, PatchList } from '../shared/schemas';

interface ListRow {
	id: string;
	name: string;
	icon: string | null;
	parent_id: string | null;
	kind: 'manual' | 'smart';
	query: string | null;
	item_count: number;
	created_at: number;
}

const toList = (r: ListRow): List => ({
	id: r.id,
	name: r.name,
	icon: r.icon,
	parentId: r.parent_id,
	kind: r.kind,
	query: r.query,
	itemCount: r.kind === 'manual' ? r.item_count : 0,
	createdAt: r.created_at,
});

export class ListError extends Error {
	constructor(
		readonly status: 400 | 404,
		message: string,
	) {
		super(message);
	}
}

export async function allLists(db: D1Database): Promise<List[]> {
	const { results } = await db.prepare('SELECT * FROM lists ORDER BY name COLLATE NOCASE').all<ListRow>();
	return results.map(toList);
}

export async function getList(db: D1Database, id: string): Promise<List | null> {
	const row = await db.prepare('SELECT * FROM lists WHERE id = ?').bind(id).first<ListRow>();
	return row ? toList(row) : null;
}

/** A list can't become its own ancestor. */
async function assertParent(db: D1Database, id: string | null, parentId: string | null | undefined) {
	if (!parentId) return;
	const lists = await allLists(db);
	const byId = new Map(lists.map((l) => [l.id, l]));
	if (!byId.has(parentId)) throw new ListError(400, 'Parent list not found.');
	for (let cur: string | null = parentId; cur; cur = byId.get(cur)?.parentId ?? null) {
		if (cur === id) throw new ListError(400, "A list can't be inside itself.");
	}
}

export async function createList(db: D1Database, input: CreateList & { kind: 'manual' | 'smart' }, now = Date.now()): Promise<List> {
	await assertParent(db, null, input.parentId);
	const id = crypto.randomUUID();
	await db
		.prepare('INSERT INTO lists (id, name, icon, parent_id, kind, query, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
		.bind(id, input.name, input.icon || null, input.parentId || null, input.kind, input.kind === 'smart' ? input.query : null, now)
		.run();
	return (await getList(db, id))!;
}

export async function patchList(db: D1Database, id: string, patch: PatchList): Promise<List> {
	const list = await getList(db, id);
	if (!list) throw new ListError(404, 'List not found.');
	if (patch.parentId !== undefined) await assertParent(db, id, patch.parentId);
	if (patch.query !== undefined && list.kind !== 'smart') throw new ListError(400, 'Only smart lists have a query.');
	const sets: string[] = [];
	const values: (string | null)[] = [];
	if (patch.name !== undefined) sets.push('name = ?'), values.push(patch.name);
	if (patch.icon !== undefined) sets.push('icon = ?'), values.push(patch.icon || null);
	if (patch.parentId !== undefined) sets.push('parent_id = ?'), values.push(patch.parentId || null);
	if (patch.query !== undefined) sets.push('query = ?'), values.push(patch.query);
	if (sets.length) await db.prepare(`UPDATE lists SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
	return (await getList(db, id))!;
}

/** Deletes the list (not its bookmarks); child lists move up to the top level. */
export async function deleteList(db: D1Database, id: string): Promise<boolean> {
	const [, , res] = await db.batch([
		db.prepare('UPDATE lists SET parent_id = NULL WHERE parent_id = ?').bind(id),
		db.prepare('DELETE FROM bookmark_lists WHERE list_id = ?').bind(id),
		db.prepare('DELETE FROM lists WHERE id = ?').bind(id),
	]);
	return res.meta.changes > 0;
}

async function manualList(db: D1Database, id: string): Promise<List> {
	const list = await getList(db, id);
	if (!list) throw new ListError(404, 'List not found.');
	if (list.kind !== 'manual') throw new ListError(400, 'Smart lists fill themselves from their search.');
	return list;
}

/** Idempotent. `changes()` makes the count move only when a row was really added/removed. */
export async function addToList(db: D1Database, listId: string, bookmarkId: string): Promise<void> {
	await manualList(db, listId);
	const exists = await db.prepare('SELECT 1 FROM bookmarks WHERE id = ?').bind(bookmarkId).first();
	if (!exists) throw new ListError(404, 'Bookmark not found.');
	await db.batch([
		db.prepare('INSERT OR IGNORE INTO bookmark_lists (bookmark_id, list_id) VALUES (?, ?)').bind(bookmarkId, listId),
		db.prepare('UPDATE lists SET item_count = item_count + changes() WHERE id = ?').bind(listId),
	]);
}

export async function removeFromList(db: D1Database, listId: string, bookmarkId: string): Promise<void> {
	await manualList(db, listId);
	await db.batch([
		db.prepare('DELETE FROM bookmark_lists WHERE bookmark_id = ? AND list_id = ?').bind(bookmarkId, listId),
		db.prepare('UPDATE lists SET item_count = item_count - changes() WHERE id = ?').bind(listId),
	]);
}
