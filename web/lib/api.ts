import type { Bookmark, BookmarkPage, CreateBookmark, PatchBookmark } from '../../shared/schemas';
import { redirect } from './router.svelte';
import { setSessionHint } from './session';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`/api/v1${path}`, {
		...init,
		headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
	});
	if (res.status === 204) return undefined as T;
	const body = await res.json().catch(() => ({}));
	if (res.status === 401 && path !== '/auth/login') {
		// Session expired or the secret was rotated: back to sign-in.
		setSessionHint(false);
		redirect('/login');
	}
	if (!res.ok) throw new ApiError(res.status, body.error ?? 'error', body.message ?? `Request failed (${res.status})`);
	return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export type View = 'home' | 'favourites' | 'archive';

export const api = {
	me: () => request<{ ok: true }>('/me'),
	login: (secret: string) => request<void>('/auth/login', json('POST', { secret })),
	logout: () => request<void>('/auth/logout', { method: 'POST' }),
	list: (view: View, cursor?: string, q?: string) => {
		const params = new URLSearchParams({ view, limit: '30' });
		if (cursor) params.set('cursor', cursor);
		if (q) params.set('q', q);
		return request<BookmarkPage>(`/bookmarks?${params}`);
	},
	get: (id: string) => request<Bookmark>(`/bookmarks/${id}`),
	create: (input: CreateBookmark) => request<{ bookmark: Bookmark; alreadyExists: boolean }>('/bookmarks', json('POST', input)),
	patch: (id: string, patch: PatchBookmark) => request<Bookmark>(`/bookmarks/${id}`, json('PATCH', patch)),
	remove: (id: string) => request<void>(`/bookmarks/${id}`, { method: 'DELETE' }),
};

/** Tell the Zerostash extension (if installed) to fetch previews now. */
export function notifyExtension() {
	window.postMessage({ type: 'zerostash:saved' }, location.origin);
}
