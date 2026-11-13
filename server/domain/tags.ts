// Tags. human_count/ai_count are kept in step with tags_on_bookmarks inside the same batch as
// every attach/detach (and bookmark delete), so tag lists never scan tags_on_bookmarks.
// Names are unique ignoring ASCII case (SQLite NOCASE).
import { fold } from '../../shared/query';
import type { AttachedBy, Tag, TagRef } from '../../shared/schemas';
import { contains, DomainError, isUniqueViolation, marks, notFound } from './util';

interface Row {
	id: string;
	name: string;
	human_count: number;
	ai_count: number;
}

const toTag = (r: Row): Tag => ({
	id: r.id,
	name: r.name,
	numBookmarks: r.human_count + r.ai_count,
	numBookmarksByAttachedType: { human: r.human_count, ai: r.ai_count },
});

// ponytail: one page of tags (no cursor); add keyset paging on (usage, id) if someone ends up
// with thousands of tags.
export async function listTags(
	db: D1Database,
	q: { nameContains?: string; ids?: string[]; attachedBy?: AttachedBy | 'none'; sortBy?: 'name' | 'usage' | 'relevance'; limit?: number } = {},
): Promise<Tag[]> {
	const where: string[] = [];
	const params: (string | number)[] = [];
	if (q.nameContains) where.push(`name LIKE ? ESCAPE '\\'`), params.push(contains(q.nameContains));
	if (q.ids?.length) where.push(`id IN (${marks(q.ids.length)})`), params.push(...q.ids);
	if (q.attachedBy === 'human') where.push('human_count > 0');
	if (q.attachedBy === 'ai') where.push('ai_count > 0');
	if (q.attachedBy === 'none') where.push('human_count + ai_count = 0');
	const order = q.sortBy === 'name' ? 'name COLLATE NOCASE' : '(human_count + ai_count) DESC, name COLLATE NOCASE';
	const { results } = await db
		.prepare(`SELECT * FROM tags ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`)
		.bind(...params, Math.min(q.limit ?? 1000, 1000))
		.all<Row>();
	return results.map(toTag);
}

export async function getTag(db: D1Database, id: string): Promise<Tag> {
	const row = await db.prepare('SELECT * FROM tags WHERE id = ?').bind(id).first<Row>();
	if (!row) throw notFound('Tag');
	return toTag(row);
}

export async function createTag(db: D1Database, name: string, now = Date.now()): Promise<Tag> {
	const id = crypto.randomUUID();
	try {
		await db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)').bind(id, name, now).run();
	} catch (err) {
		if (isUniqueViolation(err)) throw new DomainError('CONFLICT', `Tag "${name}" already exists.`);
		throw err;
	}
	return getTag(db, id);
}

/** Bookmarks showing this tag change: bump them for delta sync. */
const bumpTagged = (db: D1Database, tagId: string, now: number) =>
	db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id IN (SELECT bookmark_id FROM tags_on_bookmarks WHERE tag_id = ?)').bind(now, tagId);

export async function renameTag(db: D1Database, id: string, name: string | undefined, now = Date.now()): Promise<Tag> {
	await getTag(db, id);
	if (name !== undefined) {
		try {
			await db.batch([db.prepare('UPDATE tags SET name = ? WHERE id = ?').bind(name, id), bumpTagged(db, id, now)]);
		} catch (err) {
			if (isUniqueViolation(err)) throw new DomainError('CONFLICT', `Tag "${name}" already exists.`);
			throw err;
		}
	}
	return getTag(db, id);
}

export async function deleteTag(db: D1Database, id: string, now = Date.now()): Promise<void> {
	const [, res] = await db.batch([bumpTagged(db, id, now), db.prepare('DELETE FROM tags WHERE id = ?').bind(id)]);
	if (!res.meta.changes) throw notFound('Tag');
}

export async function deleteUnusedTags(db: D1Database): Promise<number> {
	return (await db.prepare('DELETE FROM tags WHERE human_count + ai_count = 0').run()).meta.changes;
}

/** Move every bookmark of `fromIds` onto `intoId`, then delete the `fromIds` tags. */
export async function mergeTags(db: D1Database, intoId: string, fromIds: string[], now = Date.now()): Promise<{ mergedIntoTagId: string; deletedTags: string[] }> {
	await getTag(db, intoId);
	const from = [...new Set(fromIds)].filter((id) => id !== intoId);
	if (!from.length) return { mergedIntoTagId: intoId, deletedTags: [] };
	await db.batch([
		db.prepare(`UPDATE bookmarks SET updated_at = ? WHERE id IN (SELECT bookmark_id FROM tags_on_bookmarks WHERE tag_id IN (${marks(from.length)}))`).bind(now, ...from),
		db
			.prepare(
				`INSERT OR IGNORE INTO tags_on_bookmarks (bookmark_id, tag_id, attached_by)
				 SELECT bookmark_id, ?, attached_by FROM tags_on_bookmarks WHERE tag_id IN (${marks(from.length)})`,
			)
			.bind(intoId, ...from),
		db.prepare(`DELETE FROM tags WHERE id IN (${marks(from.length)})`).bind(...from),
		// Rare operation: recount the merged tag from its rows (reads = its bookmarks).
		db
			.prepare(
				`UPDATE tags SET
					human_count = (SELECT COUNT(*) FROM tags_on_bookmarks WHERE tag_id = ?1 AND attached_by = 'human'),
					ai_count = (SELECT COUNT(*) FROM tags_on_bookmarks WHERE tag_id = ?1 AND attached_by = 'ai')
				 WHERE id = ?1`,
			)
			.bind(intoId),
	]);
	return { mergedIntoTagId: intoId, deletedTags: from };
}

/**
 * Attach/detach tags on one bookmark. Names are created on first use. Set-based, so a call is
 * at most ~10 statements however many tags it touches (Free plan: 50 queries per invocation).
 * Idempotent: counts move only for memberships that really change. Returns the tag ids touched.
 */
export async function updateTags(
	db: D1Database,
	bookmarkId: string,
	attach: TagRef[],
	detach: TagRef[],
	now = Date.now(),
): Promise<{ attached: string[]; detached: string[] }> {
	if (!(await db.prepare('SELECT 1 FROM bookmarks WHERE id = ?').bind(bookmarkId).first())) throw notFound('Bookmark');

	// Resolve names to ids, creating attach-side names that don't exist yet (one multi-row insert).
	const newNames = [...new Set(attach.filter((r) => !r.tagId).map((r) => r.tagName!))];
	const allNames = [...new Set([...attach, ...detach].filter((r) => !r.tagId).map((r) => r.tagName!))];
	const idByName = new Map<string, string>();
	if (allNames.length) {
		const res = await db.batch([
			...(newNames.length
				? [
						db
							.prepare(`INSERT OR IGNORE INTO tags (id, name, created_at) VALUES ${newNames.map(() => '(?, ?, ?)').join(', ')}`)
							.bind(...newNames.flatMap((name) => [crypto.randomUUID(), name, now])),
					]
				: []),
			db.prepare(`SELECT id, name FROM tags WHERE name IN (${marks(allNames.length)})`).bind(...allNames),
		]);
		for (const r of res[res.length - 1].results as { id: string; name: string }[]) idByName.set(fold(r.name), r.id);
	}
	const idOf = (r: TagRef) => r.tagId ?? idByName.get(fold(r.tagName!));
	const by = new Map<string, AttachedBy>();
	for (const r of attach) {
		const id = idOf(r);
		if (id) by.set(id, r.attachedBy ?? 'human');
	}
	const detachIds = [...new Set(detach.map(idOf).filter((id): id is string => !!id))].filter((id) => !by.has(id));
	const attachIds = { human: [...by].filter(([, b]) => b === 'human').map(([id]) => id), ai: [...by].filter(([, b]) => b === 'ai').map(([id]) => id) };

	const stmts: D1PreparedStatement[] = [];
	if (detachIds.length) {
		// Counts first, while the rows still say which counter they belong to.
		for (const kind of ['human', 'ai'] as const) {
			stmts.push(
				db
					.prepare(
						`UPDATE tags SET ${kind}_count = ${kind}_count - 1 WHERE id IN
						 (SELECT tag_id FROM tags_on_bookmarks WHERE bookmark_id = ? AND attached_by = '${kind}' AND tag_id IN (${marks(detachIds.length)}))`,
					)
					.bind(bookmarkId, ...detachIds),
			);
		}
		stmts.push(db.prepare(`DELETE FROM tags_on_bookmarks WHERE bookmark_id = ? AND tag_id IN (${marks(detachIds.length)})`).bind(bookmarkId, ...detachIds));
	}
	for (const kind of ['human', 'ai'] as const) {
		const ids = attachIds[kind];
		if (!ids.length) continue;
		// Count only tags not already on the bookmark, then insert (existing rows are kept).
		stmts.push(
			db
				.prepare(
					`UPDATE tags SET ${kind}_count = ${kind}_count + 1 WHERE id IN (${marks(ids.length)})
					 AND id NOT IN (SELECT tag_id FROM tags_on_bookmarks WHERE bookmark_id = ?)`,
				)
				.bind(...ids, bookmarkId),
			db
				.prepare(`INSERT OR IGNORE INTO tags_on_bookmarks (bookmark_id, tag_id, attached_by) SELECT ?, id, '${kind}' FROM tags WHERE id IN (${marks(ids.length)})`)
				.bind(bookmarkId, ...ids),
		);
	}
	if (stmts.length) {
		stmts.push(db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').bind(now, bookmarkId));
		await db.batch(stmts);
	}
	return { attached: [...by.keys()], detached: detachIds };
}
