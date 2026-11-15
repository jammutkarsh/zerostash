import { hc } from 'hono/client';
import { ApiError, ok } from '../../../shared/http';
import type { CreateBookmark, OgPatch, PatchBookmark } from '../../../shared/schemas';
import type { ApiType } from '../../../server/routes';
import { getSettings } from './settings';

export { ApiError };

type Connection = { serverUrl: string; secret: string };

/** Typed client for the user's server, with the Bearer secret. The server's CORS allows extension origins. */
async function v1(override?: Connection) {
	const { serverUrl, secret } = override ?? (await getSettings());
	if (!serverUrl || !secret) throw new ApiError(0, 'not_configured', 'Connect the extension to your server first.');
	return hc<ApiType>(serverUrl, { headers: { authorization: `Bearer ${secret}` } }).api.v1;
}

export const API_VERSION = 1;

export const server = {
	health: (serverUrl: string) => ok(hc<ApiType>(serverUrl).api.v1.health.$get()),
	me: async (override?: Connection) => ok((await v1(override)).me.$get()),
	create: async (input: CreateBookmark) => ok((await v1()).bookmarks.$post({ json: input })),
	patch: async (id: string, patch: PatchBookmark) => ok((await v1()).bookmarks[':id'].$patch({ param: { id }, json: patch })),
	remove: async (id: string) => ok((await v1()).bookmarks[':id'].$delete({ param: { id } })),
	needsOg: async () => ok((await v1()).bookmarks['needs-og'].$get({ query: { limit: '20' } })),
	putOg: async (id: string, og: OgPatch) => ok((await v1()).bookmarks[':id'].og.$put({ param: { id }, json: og })),
};
