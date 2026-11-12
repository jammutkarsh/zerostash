import { hc } from 'hono/client';
import { ok } from '../../shared/http';
import type { CreateBookmark, CreateList, PatchBookmark, PatchList } from '../../shared/schemas';
import type { ApiType } from '../../server/routes';
import { redirect } from './router.svelte';
import { setSessionHint } from './session';
import { clearCache } from './store.svelte';

export { ApiError } from '../../shared/http';

// Typed client: paths, params, bodies and responses all come from server/routes.ts.
const v1 = hc<ApiType>(location.origin, {
	fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
		const res = await fetch(input, init);
		if (res.status === 401 && !String(input).endsWith('/auth/login')) {
			// Session expired or the secret was rotated: back to sign-in.
			setSessionHint(false);
			clearCache();
			redirect('/login');
		}
		return res;
	},
}).api.v1;

export type View = 'home' | 'favourites' | 'archive';

export const api = {
	me: () => ok(v1.me.$get()),
	login: (secret: string) => ok(v1.auth.login.$post({ json: { secret } })),
	logout: () => ok(v1.auth.logout.$post()),
	changes: (since?: number) => ok(v1.changes.$get({ query: { since: since?.toString() } })),
	list: ({ limit = 30, ...o }: { view: View; cursor?: string; q?: string; list?: string; limit?: number }) =>
		ok(v1.bookmarks.$get({ query: { ...o, limit: String(limit) } })),
	get: (id: string) => ok(v1.bookmarks[':id'].$get({ param: { id } })),
	create: (input: CreateBookmark) => ok(v1.bookmarks.$post({ json: input })),
	patch: (id: string, patch: PatchBookmark) => ok(v1.bookmarks[':id'].$patch({ param: { id }, json: patch })),
	// keepalive lets a delete still pending when the tab closes reach the server.
	remove: (id: string, keepalive = false) => ok(v1.bookmarks[':id'].$delete({ param: { id } }, keepalive ? { init: { keepalive } } : undefined)),
	createList: (input: CreateList) => ok(v1.lists.$post({ json: input })),
	patchList: (id: string, patch: PatchList) => ok(v1.lists[':id'].$patch({ param: { id }, json: patch })),
	deleteList: (id: string) => ok(v1.lists[':id'].$delete({ param: { id } })),
	addToList: (id: string, bookmarkId: string) => ok(v1.lists[':id'].bookmarks[':bookmarkId'].$put({ param: { id, bookmarkId } })),
	removeFromList: (id: string, bookmarkId: string) => ok(v1.lists[':id'].bookmarks[':bookmarkId'].$delete({ param: { id, bookmarkId } })),
};

/** Tell the Zerostash extension (if installed) to fetch previews now. */
export function notifyExtension() {
	window.postMessage({ type: 'zerostash:saved' }, location.origin);
}
