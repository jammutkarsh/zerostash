// Local-first store: the browser keeps a copy of every bookmark, so views, lists, smart lists,
// tags and search are worked out here, instantly, without asking the server.
// - The copy lives in IndexedDB (idb.ts) and loads on start.
// - First visit: the screen's own first page comes straight from the server (`peek`) while
//   every bookmark downloads in the background, Home and Archive in parallel, newest first,
//   one request per page so each stays inside the Worker's 10 ms CPU budget.
// - Delta sync (`pull`: zerostash.changes) keeps the copy current on open, on tab focus, when
//   the network comes back and every two minutes. When the server answers `reset` (first
//   visit, offline for 30+ days, 100+ changes), the download runs again with the old copy shown.
// - Favourite/archive/delete/list changes show immediately and sync behind the scenes,
//   rolling back with a toast if the server refuses.
// ponytail: everything sits in memory and every view is a filter over all of it; fine to
// ~20k bookmarks. Past that, query IndexedDB by index instead.
import { parseQuery } from '../../shared/query';
import type { Bookmark, EditList, List, NewList, Tag } from '../../shared/schemas';
import { api, deleteOnUnload, errorMessage } from './api';
import * as idb from './idb';
import { byNewest, listPredicate, type MatchContext, queryPredicate } from './match';
import { toast, undoToast } from './toast.svelte';

export type View = 'home' | 'favourites' | 'archive';

/** `version` bumps on every change to the bookmarks; `complete` = the whole library is here. */
export const sync = $state({ version: 0, ready: false, complete: false, error: '' });
export const lists = $state<{ items: List[] }>({ items: [] });
export const tags = $state<{ items: Tag[] }>({ items: [] });

// Bookmarks are plain objects, replaced on every change and never mutated in place.
const byId = new Map<string, Bookmark>();
let since: number | undefined;
const newer = (a: Bookmark, b: Bookmark) => a.modifiedAt.getTime() > b.modifiedAt.getTime();

const hydrated = idb.load().then(({ bookmarks, meta }) => {
	// Anything the server sent while this loaded is at least as new: keep it.
	for (const b of bookmarks) {
		const mine = byId.get(b.id);
		if (!mine || newer(b, mine)) byId.set(b.id, b);
	}
	if (!lists.items.length && meta.lists) lists.items = meta.lists;
	if (!tags.items.length && meta.tags) tags.items = meta.tags;
	since = meta.since;
	sync.complete = since !== undefined;
	sync.ready = true;
	sync.version++;
});

let sorted: Bookmark[] = [];
let sortedAt = -1;
function all(): Bookmark[] {
	if (sortedAt !== sync.version) {
		sorted = [...byId.values()].sort(byNewest);
		sortedAt = sync.version;
	}
	return sorted;
}

function matchContext(): MatchContext {
	const names = new Map(lists.items.map((l) => [l.id, l.name]));
	return { now: Date.now(), listName: (id) => names.get(id), feedName: () => undefined };
}

export interface Selection {
	view: View;
	q?: string;
	listId?: string;
	tagId?: string;
}

/**
 * What a view shows, newest first, mirroring the server: search, lists and tags span archived
 * bookmarks too; a smart list is its hand-added members plus its query's matches.
 */
function select(items: Bookmark[], s: Selection): Bookmark[] {
	if (s.q) return items.filter(queryPredicate(parseQuery(s.q), matchContext()));
	if (s.tagId) return items.filter((b) => b.tags.some((t) => t.id === s.tagId));
	if (s.listId) {
		const list = lists.items.find((l) => l.id === s.listId);
		const parsed = list?.type === 'smart' && list.query ? parseQuery(list.query) : null;
		return items.filter(listPredicate({ id: s.listId, type: list?.type ?? 'manual', parsed }, matchContext()));
	}
	if (s.view === 'favourites') return items.filter((b) => b.favourited);
	return items.filter((b) => b.archived === (s.view === 'archive'));
}

/** Reactive: re-runs when bookmarks or lists change. */
export function viewItems(s: Selection): Bookmark[] {
	return select(all(), s);
}

/**
 * Bookmarks per sidebar entry (home, archive, favourites, list ids), counted locally.
 * Undefined until the whole library is here, so counts never climb mid-download.
 */
export function sidebarCounts(): Record<string, number> | undefined {
	if (!sync.complete) return undefined;
	const items = all();
	const out: Record<string, number> = {};
	for (const view of ['home', 'archive', 'favourites'] as const) out[view] = select(items, { view }).length;
	for (const list of lists.items) out[list.id] = select(items, { view: 'home', listId: list.id }).length;
	return out;
}

export function findBookmark(id: string): Bookmark | undefined {
	return byId.get(id);
}

// ---- persistence ----

const dirty = new Set<string>();
const gone = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persistSoon() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(flush, 300);
}

function flush() {
	clearTimeout(saveTimer);
	const put = [...dirty].flatMap((id) => byId.get(id) ?? []);
	const del = [...gone];
	dirty.clear();
	gone.clear();
	// The cursor is saved only once the copy is whole, so an interrupted download starts over.
	void idb.save(put, del, { since: sync.complete ? since : undefined, lists: $state.snapshot(lists.items), tags: $state.snapshot(tags.items) });
}

function changed() {
	sync.version++;
	persistSoon();
}

function put(b: Bookmark) {
	if (pendingDeletes.has(b.id)) return;
	byId.set(b.id, b);
	dirty.add(b.id);
	gone.delete(b.id);
}

function forget(id: string): boolean {
	if (!byId.delete(id)) return false;
	dirty.delete(id);
	gone.add(id);
	return true;
}

/** Server data: overwrites the local copy only if newer, so a late reply can't undo a fresh edit. */
function merge(items: Bookmark[]) {
	let n = 0;
	for (const b of items) {
		const mine = byId.get(b.id);
		if (mine && !newer(b, mine)) continue;
		put(b);
		n++;
	}
	if (n) changed();
}

/** A bookmark this page just saved or changed: always wins. */
export function upsert(b: Bookmark) {
	put(b);
	changed();
}

/** Wipe everything (sign-out, expired session): bookmarks shouldn't outlive the session. */
export function clearCache() {
	byId.clear();
	dirty.clear();
	gone.clear();
	clearTimeout(saveTimer);
	lists.items = [];
	tags.items = [];
	since = undefined;
	sync.complete = false;
	sync.version++;
	void idb.wipe();
}

// ---- edits ----

export const urlOf = (b: Bookmark) => (b.content.type === 'link' ? b.content.url : null);
export const titleOf = (b: Bookmark) =>
	b.title || (b.content.type === 'link' ? b.content.title || b.content.url : b.content.type === 'text' ? b.content.text : b.content.fileName) || '';
const short = (b: Bookmark) => (titleOf(b) || 'note').slice(0, 40);

/** Optimistic favourite/archive toggle. Archiving moves the card out of view, so it gets an Undo toast. */
export async function toggle(id: string, field: 'favourited' | 'archived') {
	const before = byId.get(id);
	if (!before) return;
	const value = !before[field];
	if (field === 'archived') {
		undoToast(value ? `Archived “${short(before)}”.` : `Moved “${short(before)}” back to Home.`, () =>
			void setField({ ...before, archived: value }, 'archived', !value),
		);
	}
	await setField(before, field, value);
}

async function setField(before: Bookmark, field: 'favourited' | 'archived', value: boolean) {
	upsert({ ...before, [field]: value, modifiedAt: new Date() });
	try {
		upsert(await api.bookmarks.updateBookmark.mutate({ bookmarkId: before.id, [field]: value }));
	} catch {
		upsert(before);
		toast(`Couldn't ${field === 'favourited' ? 'update favourite' : value ? 'archive' : 'unarchive'}. Undone.`);
	}
}

/** Title / note edits (not optimistic: the server's answer replaces the card). */
export async function editBookmark(id: string, patch: { title?: string | null; note?: string }) {
	upsert(await api.bookmarks.updateBookmark.mutate({ bookmarkId: id, ...patch }));
}

// Deletes wait out an undo window before reaching the server. Until then the bookmark is
// hidden locally, and server pages and syncs must not bring it back.
const UNDO_MS = 5000;
const pendingDeletes = new Map<string, { snapshot: Bookmark; timer: ReturnType<typeof setTimeout>; sent: boolean }>();
addEventListener('pagehide', () => {
	for (const [id, p] of pendingDeletes) if (!p.sent) deleteOnUnload(id);
	flush();
});

/** Optimistic delete with an Undo toast. */
export function remove(id: string) {
	const snapshot = byId.get(id);
	if (!snapshot || pendingDeletes.has(id)) return;
	forget(id);
	changed();
	pendingDeletes.set(id, { snapshot, timer: setTimeout(() => void commitDelete(id), UNDO_MS), sent: false });
	undoToast(`Deleted “${short(snapshot)}”.`, () => undoDelete(id), UNDO_MS);
}

function undoDelete(id: string) {
	const p = pendingDeletes.get(id);
	if (!p || p.sent) return;
	clearTimeout(p.timer);
	pendingDeletes.delete(id);
	upsert(p.snapshot);
}

async function commitDelete(id: string) {
	const p = pendingDeletes.get(id);
	if (!p || p.sent) return;
	p.sent = true;
	clearTimeout(p.timer);
	try {
		await api.bookmarks.deleteBookmark.mutate({ bookmarkId: id });
		pendingDeletes.delete(id);
	} catch {
		pendingDeletes.delete(id);
		upsert(p.snapshot);
		toast("Couldn't delete. Restored.");
	}
}

// ---- lists ----

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export async function createList(input: NewList): Promise<List> {
	const list = await api.lists.create.mutate(input);
	lists.items = [...lists.items, list].sort(byName);
	persistSoon();
	return list;
}

export async function updateList(patch: EditList): Promise<List> {
	const list = await api.lists.edit.mutate(patch);
	lists.items = lists.items.map((l) => (l.id === list.id ? list : l)).sort(byName);
	changed(); // a smart list's query decides what it shows
	return list;
}

export async function deleteList(id: string) {
	await api.lists.delete.mutate({ listId: id });
	lists.items = lists.items.filter((l) => l.id !== id).map((l) => (l.parentId === id ? { ...l, parentId: null } : l));
	for (const b of [...byId.values()]) if (b.listIds.includes(id)) put({ ...b, listIds: b.listIds.filter((x) => x !== id) });
	changed();
}

/** Optimistic add/remove of a bookmark in a list. */
export async function setInList(bookmarkId: string, listId: string, member: boolean) {
	const before = byId.get(bookmarkId);
	if (!before || before.listIds.includes(listId) === member) return;
	upsert({ ...before, listIds: member ? [...before.listIds, listId] : before.listIds.filter((x) => x !== listId), modifiedAt: new Date() });
	try {
		await (member ? api.lists.addToList : api.lists.removeFromList).mutate({ listId, bookmarkId });
	} catch {
		upsert(before);
		toast(`Couldn't ${member ? 'add to' : 'remove from'} the list. Undone.`);
	}
}

// ---- tags ----

async function refreshTags() {
	tags.items = (await api.tags.list.query({})).tags;
	persistSoon();
}

/** Attach (by name, created on first use) or detach (by id) tags, then refresh the card and the tag list. */
export async function setTags(bookmarkId: string, change: { attach?: string[]; detach?: string[] }) {
	try {
		await api.bookmarks.updateTags.mutate({
			bookmarkId,
			attach: (change.attach ?? []).map((tagName) => ({ tagName })),
			detach: (change.detach ?? []).map((tagId) => ({ tagId })),
		});
		const [b] = await Promise.all([api.bookmarks.getBookmark.query({ bookmarkId }), refreshTags()]);
		upsert(b);
	} catch (e) {
		toast(`Couldn't update tags: ${errorMessage(e)}`);
	}
}

export async function renameTag(tagId: string, name: string) {
	await api.tags.update.mutate({ tagId, name });
	await refreshTags();
	void pull(); // its bookmarks changed on the server
}

export async function deleteTag(tagId: string) {
	await api.tags.delete.mutate({ tagId });
	tags.items = tags.items.filter((t) => t.id !== tagId);
	for (const b of [...byId.values()]) if (b.tags.some((t) => t.id === tagId)) put({ ...b, tags: b.tags.filter((t) => t.id !== tagId) });
	changed();
}

// ---- sync ----

/** One page from the server for what a screen shows. */
function serverPage(s: Selection, cursor?: string, limit = 30) {
	if (s.q) return api.bookmarks.searchBookmarks.query({ text: s.q, cursor, limit });
	return api.bookmarks.getBookmarks.query({
		cursor,
		limit,
		...(s.listId ? { listId: s.listId } : s.tagId ? { tagId: s.tagId } : s.view === 'favourites' ? { favourited: true } : { archived: s.view === 'archive' }),
	});
}

/**
 * Until the whole library is here, ask the server for this screen's first page so it fills
 * at once. Searches scan every row in D1, so callers debounce those.
 */
export async function peek(s: Selection) {
	await hydrated;
	if (sync.complete) return;
	try {
		merge((await serverPage(s)).bookmarks);
	} catch {}
}

/** Every bookmark, Home and Archive side by side, newest first: the screen fills top down. */
async function download(cursor: number) {
	const seen = new Set<string>();
	await Promise.all(
		(['home', 'archive'] as const).map(async (view) => {
			let next: string | undefined;
			do {
				const page = await serverPage({ view }, next, next ? 100 : 30);
				for (const b of page.bookmarks) seen.add(b.id);
				merge(page.bookmarks);
				next = page.nextCursor ?? undefined;
			} while (next);
		}),
	);
	// Deleted on the server while this browser wasn't syncing (its tombstone has expired):
	// drop it, unless it changed after the download began.
	let n = 0;
	for (const b of [...byId.values()]) if (!seen.has(b.id) && b.modifiedAt.getTime() < cursor && forget(b.id)) n++;
	if (n) changed();
}

let pulling: Promise<void> | undefined;
/** Fetch what changed since the last sync, or everything when the server says `reset`. */
export function pull(): Promise<void> {
	pulling ??= (async () => {
		try {
			await hydrated;
			const res = await api.zerostash.changes.query({ since });
			lists.items = res.lists;
			tags.items = res.tags;
			if (res.reset) {
				await download(res.cursor);
				sync.complete = true;
			} else {
				merge(res.bookmarks);
				if (res.deleted.filter(forget).length) changed();
			}
			// Only advance once applied: an interrupted download retries the reset next time.
			since = res.cursor;
			sync.error = '';
			persistSoon();
		} catch (e) {
			sync.error = errorMessage(e) || "Can't reach the server right now.";
		} finally {
			pulling = undefined;
		}
	})();
	return pulling;
}

let syncing = false;
/** Sync now, then keep the copy current. Call once per dashboard visit. */
export function startSync() {
	if (syncing) return () => {};
	syncing = true;
	void pull();
	const onVisible = () => document.visibilityState === 'visible' && void pull();
	const timer = setInterval(onVisible, 2 * 60_000);
	document.addEventListener('visibilitychange', onVisible);
	addEventListener('online', onVisible);
	return () => {
		syncing = false;
		clearInterval(timer);
		document.removeEventListener('visibilitychange', onVisible);
		removeEventListener('online', onVisible);
	};
}
