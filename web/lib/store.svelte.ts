// Client cache so pages feel instant:
// - every view renders from cache first (persisted to localStorage across reloads),
//   then refreshes from the API in the background;
// - Home/Favourites/Archive are prefetched once the dashboard opens;
// - favourite/archive/delete update the screen immediately and sync behind the scenes,
//   rolling back with a toast if the server refuses;
// - feeds re-sync when the tab regains focus and every two minutes while visible.
import type { Bookmark } from '../../shared/schemas';
import { api, type View } from './api';
import { toast } from './toast.svelte';

export interface Feed {
	view: View;
	q: string;
	items: Bookmark[];
	cursor: string | null;
	done: boolean;
	loading: boolean;
	error: string;
	fetchedAt: number;
}

const STORAGE_KEY = 'zs_cache_v1';
const PERSIST_LIMIT = 60; // per view; enough for an instant first screen
const VIEWS: View[] = ['home', 'favourites', 'archive'];

export const feeds = $state<Record<string, Feed>>(restore());

export const feedKey = (view: View, q = '') => (q ? `search:${q}` : view);

function blank(view: View, q: string): Feed {
	return { view, q, items: [], cursor: null, done: false, loading: false, error: '', fetchedAt: 0 };
}

function restore(): Record<string, Feed> {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Pick<Feed, 'items' | 'cursor' | 'done'>>;
		const out: Record<string, Feed> = {};
		for (const view of VIEWS) {
			if (saved[view]) out[view] = { ...blank(view, ''), ...saved[view] };
		}
		return out;
	} catch {
		return {};
	}
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
	clearTimeout(persistTimer);
	persistTimer = setTimeout(() => {
		const out: Record<string, unknown> = {};
		for (const view of VIEWS) {
			const f = feeds[view];
			if (!f) continue;
			const items = f.items.slice(0, PERSIST_LIMIT);
			// A truncated list must not claim it's complete, or "load more" would stop.
			out[view] = { items, cursor: items.length < f.items.length ? cursorOf(items.at(-1)!) : f.cursor, done: f.done && items.length === f.items.length };
		}
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
		} catch {}
	}, 300);
}

/** Wipe everything (sign-out, expired session): bookmarks shouldn't outlive the session. */
export function clearCache() {
	for (const key of Object.keys(feeds)) delete feeds[key];
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {}
}

export function ensureFeed(view: View, q = ''): Feed {
	const key = feedKey(view, q);
	// Re-read after assigning: $state stores a reactive proxy, not the object we passed in.
	if (!feeds[key]) feeds[key] = blank(view, q);
	return feeds[key];
}

const cursorOf = (b: Bookmark) => `${b.createdAt}_${b.id}`;
const newerThan = (a: Bookmark, b: Bookmark) => a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id);

export async function loadMore(feed: Feed) {
	if (feed.loading || feed.done) return;
	feed.loading = true;
	try {
		const page = await api.list(feed.view, feed.cursor ?? undefined, feed.q || undefined);
		const seen = new Set(feed.items.map((b) => b.id));
		feed.items.push(...page.items.filter((b) => !seen.has(b.id)));
		feed.cursor = page.nextCursor;
		feed.done = !page.nextCursor;
		feed.fetchedAt = Date.now();
		feed.error = '';
		persist();
	} catch (e) {
		feed.error = e instanceof Error ? e.message : String(e);
	} finally {
		feed.loading = false;
	}
}

/**
 * Re-fetch the first page and merge it in: new and changed bookmarks appear, ones deleted
 * elsewhere disappear, and anything already loaded below the first page stays put.
 */
export async function refresh(feed: Feed) {
	if (feed.loading) return;
	if (!feed.fetchedAt && !feed.items.length) return loadMore(feed);
	try {
		const page = await api.list(feed.view, undefined, feed.q || undefined);
		const fresh = page.items;
		if (!page.nextCursor) {
			feed.items = fresh;
			feed.cursor = null;
			feed.done = true;
		} else {
			const oldest = fresh.at(-1)!;
			const ids = new Set(fresh.map((b) => b.id));
			const tail = feed.items.filter((b) => !ids.has(b.id) && newerThan(oldest, b));
			feed.items = [...fresh, ...tail];
			if (!tail.length) {
				feed.cursor = page.nextCursor;
				feed.done = false;
			}
		}
		feed.fetchedAt = Date.now();
		feed.error = '';
		persist();
	} catch {
		// Background sync is best-effort; the cached view stays usable.
	}
}

function belongs(feed: Feed, b: Bookmark): boolean {
	if (feed.q) return feed.items.some((x) => x.id === b.id); // searches only update in place
	return feed.view === 'favourites' ? b.favourited : feed.view === 'archive' ? b.archived : !b.archived;
}

/** Put a bookmark into every cached view it belongs to (and out of the ones it doesn't). */
export function upsert(b: Bookmark) {
	for (const feed of Object.values(feeds)) {
		const i = feed.items.findIndex((x) => x.id === b.id);
		if (!belongs(feed, b)) {
			if (i !== -1) feed.items.splice(i, 1);
			continue;
		}
		if (i !== -1) {
			feed.items[i] = b;
			continue;
		}
		const at = feed.items.findIndex((x) => newerThan(b, x));
		if (at !== -1) feed.items.splice(at, 0, b);
		else if (feed.done) feed.items.push(b); // older than everything loaded: only add if the list is complete
	}
	persist();
}

function find(id: string): Bookmark | undefined {
	for (const feed of Object.values(feeds)) {
		const b = feed.items.find((x) => x.id === id);
		if (b) return b;
	}
}

/** Optimistic favourite/archive toggle. */
export async function toggle(id: string, field: 'favourited' | 'archived') {
	const before = find(id);
	if (!before) return;
	const value = !before[field];
	upsert({ ...$state.snapshot(before), [field]: value });
	try {
		upsert(await api.patch(id, { [field]: value }));
	} catch {
		upsert(before);
		toast(`Couldn't ${field === 'favourited' ? 'update favourite' : value ? 'archive' : 'unarchive'}. Undone.`);
	}
}

/** Optimistic delete. */
export async function remove(id: string) {
	const before = find(id);
	if (!before) return;
	const snapshot = $state.snapshot(before);
	for (const feed of Object.values(feeds)) {
		const i = feed.items.findIndex((x) => x.id === id);
		if (i !== -1) feed.items.splice(i, 1);
	}
	persist();
	try {
		await api.remove(id);
	} catch {
		upsert(snapshot);
		toast("Couldn't delete. Restored.");
	}
}

let syncing = false;
/** Prefetch the main views and keep them fresh in the background. Call once per dashboard visit. */
export function startSync(current: () => Feed) {
	if (syncing) return () => {};
	syncing = true;
	const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn) : setTimeout(fn, 200));
	idle(() => VIEWS.forEach((v) => void refresh(ensureFeed(v))));
	const sync = () => document.visibilityState === 'visible' && void refresh(current());
	const timer = setInterval(sync, 2 * 60_000);
	document.addEventListener('visibilitychange', sync);
	return () => {
		syncing = false;
		clearInterval(timer);
		document.removeEventListener('visibilitychange', sync);
	};
}
