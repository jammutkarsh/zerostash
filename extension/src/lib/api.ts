import type { Bookmark, CreateBookmark, Health, OgPatch, PatchBookmark } from '../../../shared/schemas';
import { getSettings } from './settings';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

/** Calls the user's server with the Bearer secret. The server's CORS allows extension origins. */
export async function api<T>(path: string, init: RequestInit = {}, override?: { serverUrl: string; secret: string }): Promise<T> {
	const { serverUrl, secret } = override ?? (await getSettings());
	if (!serverUrl || !secret) throw new ApiError(0, 'not_configured', 'Connect the extension to your server first.');
	const res = await fetch(`${serverUrl}/api/v1${path}`, {
		...init,
		headers: { authorization: `Bearer ${secret}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
	});
	if (res.status === 204) return undefined as T;
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new ApiError(res.status, body.error ?? 'error', body.message ?? `Server returned ${res.status}`);
	return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const API_VERSION = 1;

export const server = {
	health: (serverUrl: string) => fetch(`${serverUrl}/api/v1/health`).then((r) => r.json() as Promise<Health>),
	me: (override?: { serverUrl: string; secret: string }) => api<{ ok: true; apiVersion: number }>('/me', {}, override),
	create: (input: CreateBookmark) => api<{ bookmark: Bookmark; alreadyExists: boolean }>('/bookmarks', json('POST', input)),
	patch: (id: string, patch: PatchBookmark) => api<Bookmark>(`/bookmarks/${id}`, json('PATCH', patch)),
	remove: (id: string) => api<void>(`/bookmarks/${id}`, { method: 'DELETE' }),
	needsOg: () => api<{ items: { id: string; url: string }[] }>('/bookmarks/needs-og?limit=20'),
	putOg: (id: string, og: OgPatch) => api<{ applied: boolean }>(`/bookmarks/${id}/og`, json('PUT', og)),
};
