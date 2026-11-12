// API contracts: paths, inputs and responses. Handlers live in app.ts.
// Kept free of Worker-only types (D1, Env) so the web app and the extension can import
// `ApiType` for a typed hono/client without type-checking the Worker.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
	ApiError,
	Bookmark,
	BookmarkPage,
	Changes,
	ChangesQuery,
	CreateBookmark,
	CreateList,
	Health,
	LIMITS,
	List,
	ListQuery,
	OgPatch,
	PatchBookmark,
	PatchList,
} from '../shared/schemas';

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { 'application/json': { schema } }, description });
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const errors = {
	400: json(ApiError, 'Invalid request'),
	401: json(ApiError, 'Missing or wrong secret'),
};
const IdParam = z.object({ id: z.string().max(64) });
const MemberParam = z.object({ id: z.string().max(64), bookmarkId: z.string().max(64) });

export const health = createRoute({
	method: 'get',
	path: '/api/v1/health',
	summary: 'Server info',
	description: 'Public. Name, version and API version of this server; `setupRequired` is true until ZEROSTASH_SECRET is set.',
	responses: { 200: json(Health, 'Server info') },
});

export const login = createRoute({
	method: 'post',
	path: '/api/v1/auth/login',
	summary: 'Sign in',
	description: 'Exchange the secret for an HttpOnly session cookie (used by the web app).',
	request: body(z.object({ secret: z.string().max(1024) })),
	responses: { 204: { description: 'Logged in; session cookie set' }, ...errors },
});

export const logout = createRoute({
	method: 'post',
	path: '/api/v1/auth/logout',
	summary: 'Sign out',
	description: 'Clear the session cookie.',
	responses: { 204: { description: 'Logged out' } },
});

export const me = createRoute({
	method: 'get',
	path: '/api/v1/me',
	summary: 'Check credentials',
	description: 'Returns 200 when the bearer secret or session cookie is valid.',
	responses: { 200: json(z.object({ ok: z.literal(true), version: z.string(), apiVersion: z.number() }), 'Authenticated'), ...errors },
});

export const changes = createRoute({
	method: 'get',
	path: '/api/v1/changes',
	summary: 'What changed',
	description:
		'Delta sync. Bookmarks created or changed after `since` (milliseconds), ids deleted since then, and every list. Pass the returned `cursor` as `since` next time; it overlaps the last minute, so apply items idempotently. `reset: true` (first call, `since` older than 30 days, or more than 100 changes) means reload your views from `GET /bookmarks` instead.',
	request: { query: ChangesQuery },
	responses: { 200: json(Changes, 'Changes since `since`'), ...errors },
});

export const listBookmarks = createRoute({
	method: 'get',
	path: '/api/v1/bookmarks',
	summary: 'List bookmarks',
	description:
		'Newest first, cursor-paginated. `view` picks home/favourites/archive; `q` searches every bookmark; `list` shows one list (a smart list runs its saved search).',
	request: { query: ListQuery },
	responses: { 200: json(BookmarkPage, 'A page of bookmarks, newest first'), 404: json(ApiError, 'List not found'), ...errors },
});

export const createBookmark = createRoute({
	method: 'post',
	path: '/api/v1/bookmarks',
	summary: 'Save a bookmark',
	description: 'Save a link or a text note. Saving a URL that already exists returns the existing bookmark with `alreadyExists: true`.',
	request: body(CreateBookmark),
	responses: {
		201: json(z.object({ bookmark: Bookmark, alreadyExists: z.literal(false) }), 'Created'),
		200: json(z.object({ bookmark: Bookmark, alreadyExists: z.literal(true) }), 'URL was already saved'),
		...errors,
	},
});

export const needsOg = createRoute({
	method: 'get',
	path: '/api/v1/bookmarks/needs-og',
	summary: 'Links waiting for previews',
	description: 'Used by the browser extension to fetch OpenGraph previews from the browser.',
	request: { query: z.object({ limit: z.coerce.number().int().min(1).max(LIMITS.ogBatch).default(LIMITS.ogBatch) }) },
	responses: { 200: json(z.object({ items: z.array(z.object({ id: z.string(), url: z.string() })) }), 'Links waiting for previews'), ...errors },
});

export const getBookmark = createRoute({
	method: 'get',
	path: '/api/v1/bookmarks/{id}',
	summary: 'Get a bookmark',
	description: '',
	request: { params: IdParam },
	responses: { 200: json(Bookmark, 'The bookmark'), 404: json(ApiError, 'Not found'), ...errors },
});

export const patchBookmark = createRoute({
	method: 'patch',
	path: '/api/v1/bookmarks/{id}',
	summary: 'Update a bookmark',
	description: 'Edit title, note or text; favourite or archive. Editing the title stops previews from overwriting it.',
	request: { params: IdParam, ...body(PatchBookmark) },
	responses: { 200: json(Bookmark, 'Updated'), 404: json(ApiError, 'Not found'), ...errors },
});

export const putOg = createRoute({
	method: 'put',
	path: '/api/v1/bookmarks/{id}/og',
	summary: 'Write preview data',
	description: 'Extension-supplied OpenGraph data. Ignored when a higher-priority source (the open tab, a bookmarklet) already set it.',
	request: { params: IdParam, ...body(OgPatch) },
	responses: { 200: json(z.object({ applied: z.boolean() }), 'Applied unless a higher-priority source already set it'), ...errors },
});

export const deleteBookmark = createRoute({
	method: 'delete',
	path: '/api/v1/bookmarks/{id}',
	summary: 'Delete a bookmark',
	description: '',
	request: { params: IdParam },
	responses: { 204: { description: 'Deleted' }, 404: json(ApiError, 'Not found'), ...errors },
});

export const allLists = createRoute({
	method: 'get',
	path: '/api/v1/lists',
	summary: 'All lists',
	description: 'Every list, sorted by name. Nesting comes from `parentId`; `itemCount` is kept up to date for manual lists.',
	responses: { 200: json(z.object({ items: z.array(List) }), 'Lists'), ...errors },
});

export const createList = createRoute({
	method: 'post',
	path: '/api/v1/lists',
	summary: 'Create a list',
	description:
		'A manual list holds the bookmarks you add to it. A smart list (`kind: "smart"`) holds those too, plus every bookmark matching any of its `terms` (up to 10).',
	request: body(CreateList),
	responses: { 201: json(List, 'Created'), ...errors },
});

export const patchList = createRoute({
	method: 'patch',
	path: '/api/v1/lists/{id}',
	summary: 'Update a list',
	description: "Rename, change the icon, move under another list (`parentId`, or null for the top level), or change a smart list's `terms`.",
	request: { params: IdParam, ...body(PatchList) },
	responses: { 200: json(List, 'Updated'), 404: json(ApiError, 'Not found'), ...errors },
});

export const deleteList = createRoute({
	method: 'delete',
	path: '/api/v1/lists/{id}',
	summary: 'Delete a list',
	description: 'Removes the list only; its bookmarks stay. Child lists move to the top level.',
	request: { params: IdParam },
	responses: { 204: { description: 'Deleted' }, 404: json(ApiError, 'Not found'), ...errors },
});

export const addToList = createRoute({
	method: 'put',
	path: '/api/v1/lists/{id}/bookmarks/{bookmarkId}',
	summary: 'Add a bookmark to a list',
	description: 'Works for manual and smart lists. Adding a bookmark that is already in the list does nothing.',
	request: { params: MemberParam },
	responses: { 204: { description: 'Added' }, 404: json(ApiError, 'Not found'), ...errors },
});

export const removeFromList = createRoute({
	method: 'delete',
	path: '/api/v1/lists/{id}/bookmarks/{bookmarkId}',
	summary: 'Remove a bookmark from a list',
	description: 'The bookmark itself stays.',
	request: { params: MemberParam },
	responses: { 204: { description: 'Removed' }, 404: json(ApiError, 'Not found'), ...errors },
});

// Client types come from the route configs alone (hono/client reads each route's declared
// responses, not its handler), so this never-called chain needs no handlers. Adding a route
// above without listing it here only hides it from the typed clients.
const stub = null as never;
const contract = () =>
	new OpenAPIHono()
		.openapi(health, stub)
		.openapi(login, stub)
		.openapi(logout, stub)
		.openapi(me, stub)
		.openapi(changes, stub)
		.openapi(listBookmarks, stub)
		.openapi(createBookmark, stub)
		.openapi(needsOg, stub)
		.openapi(getBookmark, stub)
		.openapi(patchBookmark, stub)
		.openapi(putOg, stub)
		.openapi(deleteBookmark, stub)
		.openapi(allLists, stub)
		.openapi(createList, stub)
		.openapi(patchList, stub)
		.openapi(deleteList, stub)
		.openapi(addToList, stub)
		.openapi(removeFromList, stub);

export type ApiType = ReturnType<typeof contract>;
