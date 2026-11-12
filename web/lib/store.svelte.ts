// Local-first store: the browser keeps a copy of every bookmark, so views, lists, smart lists
// and search are worked out here, instantly, without asking the server.
// - The copy lives in IndexedDB (idb.ts) and loads on start.
// - First visit: the screen's own first page comes straight from the server (`peek`) while
//   every bookmark downloads in the background, Home and Archive in parallel, newest first,
//   one request per page so each stays inside the Worker's 10 ms CPU budget.
// - Delta sync (`pull`: GET /changes) keeps the copy current on open, on tab focus, when the
//   network comes back and every two minutes. When the server answers `reset` (first visit,
//   offline for 30+ days, 100+ changes), the download runs again with the old copy on screen.
// - Favourite/archive/delete/list changes show immediately and sync behind the scenes,
//   rolling back with a toast if the server refuses.
// ponytail: everything sits in memory and every view is a filter over all of it; fine to
// ~20k bookmarks. Past that, query IndexedDB by index instead.
import type { Bookmark, CreateList, List, PatchList } from '../../shared/schemas';
import { api, ApiError, type View } from './api';
import * as idb from './idb';
import { byNewest, select } from './match';
import { toast, undoToast } from './toast.svelte';

/** `version` bumps on every change to the bookmarks; `complete` = the whole library is here. */
export const sync = $state({ version: 0, ready: false, complete: false, error: '' });
export const lists = $state<{ items: List[] }>({ items: [] });

// Bookmarks are plain objects, replaced on every change and never mutated in place.
const byId = new Map<string, Bookmark>();
let since: number | undefined;

// Older versions kept a partial cache here; it's superseded by IndexedDB.
try {
	for (const key of ['zs_cache_v2', 'zs_lists_v2', 'zs_since', 'zs_cache_v1', 'zs_lists_v1']) localStorage.removeItem(key);
} catch {}

const hydrated = idb.load().then(({ bookmarks, meta }) => {
	// Anything the server sent while this loaded is at least as new: keep it.
	for (const b of bookmarks) {
		const mine = byId.get(b.id);
		if (!mine || mine.updatedAt < b.updatedAt) byId.set(b.id, b);
	}
	if (!lists.items.length && meta.lists) lists.items = meta.lists;
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

/** What a view, list or search shows, newest first. Reactive: re-runs when bookmarks or lists change. */
export function viewItems(view: View, q = '', listId = ''): Bookmark[] {
	const list = listId ? (lists.items.find((l) => l.id === listId) ?? { id: listId, kind: 'manual' as const, terms: [] }) : undefined;
	return select(all(), { view, q, list });
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
	void idb.save(put, del, { since: sync.complete ? since : undefined, lists: $state.snapshot(lists.items) });
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
		if (mine && mine.updatedAt >= b.updatedAt) continue;
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
	since = undefined;
	sync.complete = false;
	sync.version++;
	void idb.wipe();
}

// ---- edits ----

const short = (b: Bookmark) => (b.title || b.url || 'note').slice(0, 40);

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
	upsert({ ...before, [field]: value });
	try {
		upsert(await api.patch(before.id, { [field]: value }));
	} catch {
		upsert(before);
		toast(`Couldn't ${field === 'favourited' ? 'update favourite' : value ? 'archive' : 'unarchive'}. Undone.`);
	}
}

// Deletes wait out an undo window before reaching the server. Until then the bookmark is
// hidden locally, and server pages and syncs must not bring it back.
const UNDO_MS = 5000;
const pendingDeletes = new Map<string, { snapshot: Bookmark; timer: ReturnType<typeof setTimeout>; sent: boolean }>();
addEventListener('pagehide', () => {
	for (const id of pendingDeletes.keys()) void commitDelete(id, true);
	flush();
});

/** Optimistic delete with an Undo toast. */
export function remove(id: string) {
	const snapshot = byId.get(id);
	if (!snapshot || pendingDeletes.has(id)) return;
	forget(id);
	bumpCounts(snapshot.listIds, -1);
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
	bumpCounts(p.snapshot.listIds, 1);
}

async function commitDelete(id: string, keepalive = false) {
	const p = pendingDeletes.get(id);
	if (!p || p.sent) return;
	p.sent = true;
	clearTimeout(p.timer);
	try {
		await api.remove(id, keepalive);
		pendingDeletes.delete(id);
	} catch {
		pendingDeletes.delete(id);
		upsert(p.snapshot);
		bumpCounts(p.snapshot.listIds, 1);
		toast("Couldn't delete. Restored.");
	}
}

// ---- lists ----

const byName = (a: List, b: List) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

function bumpCounts(listIds: string[], delta: number) {
	for (const l of lists.items) if (listIds.includes(l.id)) l.itemCount = Math.max(0, l.itemCount + delta);
}

export async function createList(input: CreateList): Promise<List> {
	const list = await api.createList(input);
	lists.items = [...lists.items, list].sort(byName);
	persistSoon();
	return list;
}

export async function updateList(id: string, patch: PatchList): Promise<List> {
	const list = await api.patchList(id, patch);
	lists.items = lists.items.map((l) => (l.id === id ? list : l)).sort(byName);
	persistSoon();
	return list;
}

export async function deleteList(id: string) {
	await api.deleteList(id);
	lists.items = lists.items.filter((l) => l.id !== id).map((l) => (l.parentId === id ? { ...l, parentId: null } : l));
	for (const b of [...byId.values()]) if (b.listIds.includes(id)) put({ ...b, listIds: b.listIds.filter((x) => x !== id) });
	changed();
}

/** Optimistic add/remove of a bookmark in a manual list. */
export async function setInList(bookmarkId: string, listId: string, member: boolean) {
	const before = byId.get(bookmarkId);
	if (!before || before.listIds.includes(listId) === member) return;
	upsert({ ...before, listIds: member ? [...before.listIds, listId] : before.listIds.filter((x) => x !== listId) });
	bumpCounts([listId], member ? 1 : -1);
	try {
		await (member ? api.addToList(listId, bookmarkId) : api.removeFromList(listId, bookmarkId));
	} catch {
		upsert(before);
		bumpCounts([listId], member ? -1 : 1);
		toast(`Couldn't ${member ? 'add to' : 'remove from'} the list. Undone.`);
	}
}

// ---- sync ----

/**
 * Until the whole library is here, ask the server for this screen's first page so it fills
 * at once. Searches scan every row in D1, so callers debounce those.
 */
export async function peek(view: View, q = '', listId = '') {
	await hydrated;
	if (sync.complete) return;
	try {
		merge((await api.list({ view, q: q || undefined, list: listId || undefined })).items);
	} catch {}
}

/** Every bookmark, Home and Archive side by side, newest first: the screen fills top down. */
async function download(cursor: number) {
	const seen = new Set<string>();
	await Promise.all(
		(['home', 'archive'] as const).map(async (view) => {
			let next: string | undefined;
			do {
				const page = await api.list({ view, cursor: next, limit: next ? 100 : 30 });
				for (const b of page.items) seen.add(b.id);
				merge(page.items);
				next = page.nextCursor ?? undefined;
			} while (next);
		}),
	);
	// Deleted on the server while this browser wasn't syncing (its tombstone has expired):
	// drop it, unless it changed after the download began.
	let n = 0;
	for (const b of [...byId.values()]) if (!seen.has(b.id) && b.updatedAt < cursor && forget(b.id)) n++;
	if (n) changed();
}

let pulling: Promise<void> | undefined;
/** Fetch what changed since the last sync, or everything when the server says `reset`. */
export function pull(): Promise<void> {
	pulling ??= (async () => {
		try {
			await hydrated;
			const res = await api.changes(since);
			lists.items = res.lists;
			if (res.reset) {
				await download(res.cursor);
				sync.complete = true;
			} else {
				merge(res.items);
				if (res.deleted.filter(forget).length) changed();
			}
			// Only advance once applied: an interrupted download retries the reset next time.
			since = res.cursor;
			sync.error = '';
			persistSoon();
		} catch (e) {
			sync.error = e instanceof ApiError ? e.message : "Can't reach the server right now.";
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
