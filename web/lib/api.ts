// The web app talks to the same tRPC API as Karakeep's extension and mobile app; types come
// straight from the server's router (server/trpc.ts). Auth is the HttpOnly session cookie.
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../server/trpc';
import { redirect } from './router.svelte';
import { setSessionHint } from './session';
import { clearCache } from './store.svelte';

export const api = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: '/api/trpc',
			transformer: superjson,
			fetch: async (input, init) => {
				const res = await fetch(input, init);
				if (res.status === 401) {
					// Session expired or the secret was rotated: back to sign-in.
					setSessionHint(false);
					clearCache();
					redirect('/login');
				}
				return res;
			},
		}),
	],
});

export const errorCode = (e: unknown) => (e instanceof TRPCClientError ? (e.data?.code as string | undefined) : undefined);
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function login(secret: string): Promise<'ok' | 'wrong' | 'setup'> {
	const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret }) });
	return res.ok ? 'ok' : res.status === 503 ? 'setup' : 'wrong';
}

export async function logout(): Promise<void> {
	await fetch('/api/auth/logout', { method: 'POST' });
}

/** A delete that must still reach the server while the tab closes (keepalive, outside the batch link). */
export function deleteOnUnload(bookmarkId: string) {
	void fetch('/api/trpc/bookmarks.deleteBookmark', {
		method: 'POST',
		keepalive: true,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(superjson.serialize({ bookmarkId })),
	});
}

/** Upload an image or PDF (POST /api/assets), then save it as an asset bookmark. */
export async function saveFile(file: File) {
	const form = new FormData();
	form.append('file', file);
	const res = await fetch('/api/assets', { method: 'POST', body: form });
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.message ?? `Upload failed (${res.status})`);
	return api.bookmarks.createBookmark.mutate({
		type: 'asset',
		assetId: body.assetId,
		assetType: body.contentType === 'application/pdf' ? 'pdf' : 'image',
		fileName: body.fileName,
		source: 'web',
	});
}
