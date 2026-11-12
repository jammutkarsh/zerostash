import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import pkg from '../package.json';
import {
	API_VERSION,
	ApiError,
	Bookmark,
	BookmarkPage,
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
import { SESSION_COOKIE, SESSION_TTL_SECONDS, secretConfigured, secretMatches, signSession, verifySession } from './auth';
import { applyOg, createBookmark, deleteBookmark, getBookmark, listBookmarks, markOgFailed, needsOg, patchBookmark } from './bookmarks';
import { addToList, allLists, createList, deleteList, getList, ListError, patchList, removeFromList } from './lists';
import privacyPolicy from './privacy-policy.md?raw';

type AppEnv = { Bindings: Env };

export const app = new OpenAPIHono<AppEnv>({
	defaultHook: (result, c) => {
		if (!result.success) {
			const message = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
			return c.json({ error: 'invalid_request', message }, 400);
		}
	},
});

// The extension calls the API cross-origin with a Bearer secret; reflect only extension
// origins (a wildcard pattern isn't valid in Access-Control-Allow-Origin). No credentials.
app.use(
	'/api/v1/*',
	cors({
		origin: (origin) => (/^(chrome|moz)-extension:\/\//.test(origin) ? origin : null),
		allowHeaders: ['Authorization', 'Content-Type'],
		allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
		maxAge: 86400,
	}),
);

app.use('/api/v1/*', async (c, next) => {
	const path = c.req.path;
	if (path === '/api/v1/health') return next();
	const secret = c.env.ZEROSTASH_SECRET;
	if (!secretConfigured(secret)) {
		return c.json(
			{ error: 'setup_required', message: 'Set the ZEROSTASH_SECRET secret (32+ random characters): `wrangler secret put ZEROSTASH_SECRET`.' },
			503,
		);
	}
	if (path === '/api/v1/auth/login') return next();
	const auth = c.req.header('authorization');
	const ok = auth?.startsWith('Bearer ')
		? await secretMatches(auth.slice(7), secret)
		: await verifySession(getCookie(c, SESSION_COOKIE), secret);
	if (!ok) return c.json({ error: 'unauthorized' }, 401);
	await next();
});

app.onError((err, c) => {
	if (err instanceof ListError) return c.json({ error: err.status === 404 ? 'not_found' : 'invalid_request', message: err.message }, err.status);
	const message = String(err);
	if (/daily row (read|write) limit/i.test(message)) {
		return c.json({ error: 'daily_limit', message: "Cloudflare's free daily database limit is used up; it resets at 00:00 UTC." }, 503);
	}
	console.error(JSON.stringify({ msg: 'unhandled', path: c.req.path, error: message }));
	return c.json({ error: 'internal', message: 'Something went wrong.' }, 500);
});

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { 'application/json': { schema } }, description });
const errors = {
	400: json(ApiError, 'Invalid request'),
	401: json(ApiError, 'Missing or wrong secret'),
};
const IdParam = z.object({ id: z.string().max(64) });

const routes = app
	.openapi(
		createRoute({ method: 'get', path: '/api/v1/health', summary: 'Server info', description: 'Public. Name, version and API version of this server; `setupRequired` is true until ZEROSTASH_SECRET is set.', responses: { 200: json(Health, 'Server info') } }),
		(c) =>
			c.json({
				name: 'zerostash' as const,
				version: pkg.version,
				apiVersion: API_VERSION,
				setupRequired: !secretConfigured(c.env.ZEROSTASH_SECRET),
			}),
	)
	.openapi(
		createRoute({
			method: 'post',
			path: '/api/v1/auth/login',
			summary: 'Sign in',
			description: 'Exchange the secret for an HttpOnly session cookie (used by the web app).',
			request: { body: { content: { 'application/json': { schema: z.object({ secret: z.string().max(1024) }) } } } },
			responses: { 204: { description: 'Logged in; session cookie set' }, ...errors },
		}),
		async (c) => {
			const secret = c.env.ZEROSTASH_SECRET;
			if (!(await secretMatches(c.req.valid('json').secret, secret))) return c.json({ error: 'unauthorized' }, 401);
			setCookie(c, SESSION_COOKIE, await signSession(secret), {
				httpOnly: true,
				secure: true,
				sameSite: 'Strict',
				path: '/',
				maxAge: SESSION_TTL_SECONDS,
			});
			return c.body(null, 204);
		},
	)
	.openapi(
		createRoute({ method: 'post', path: '/api/v1/auth/logout', summary: 'Sign out', description: 'Clear the session cookie.', responses: { 204: { description: 'Logged out' } } }),
		(c) => {
			deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
			return c.body(null, 204);
		},
	)
	.openapi(
		createRoute({
			method: 'get',
			path: '/api/v1/me',
			summary: 'Check credentials',
			description: 'Returns 200 when the bearer secret or session cookie is valid.',
			responses: { 200: json(z.object({ ok: z.literal(true), version: z.string(), apiVersion: z.number() }), 'Authenticated'), ...errors },
		}),
		(c) => c.json({ ok: true as const, version: pkg.version, apiVersion: API_VERSION }, 200),
	)
	.openapi(
		createRoute({
			method: 'get',
			path: '/api/v1/bookmarks',
			summary: 'List bookmarks',
			description:
				'Newest first, cursor-paginated. `view` picks home/favourites/archive; `q` searches every bookmark; `list` shows one list (a smart list runs its saved search).',
			request: { query: ListQuery },
			responses: { 200: json(BookmarkPage, 'A page of bookmarks, newest first'), 404: json(ApiError, 'List not found'), ...errors },
		}),
		async (c) => {
			const query = c.req.valid('query');
			const list = query.list ? await getList(c.env.DB, query.list) : undefined;
			if (query.list && !list) return c.json({ error: 'not_found', message: 'List not found.' }, 404);
			return c.json(await listBookmarks(c.env.DB, { ...query, list: list ?? undefined }), 200);
		},
	)
	.openapi(
		createRoute({
			method: 'post',
			path: '/api/v1/bookmarks',
			summary: 'Save a bookmark',
			description: 'Save a link or a text note. Saving a URL that already exists returns the existing bookmark with `alreadyExists: true`.',
			request: { body: { content: { 'application/json': { schema: CreateBookmark } }, required: true } },
			responses: {
				201: json(z.object({ bookmark: Bookmark, alreadyExists: z.literal(false) }), 'Created'),
				200: json(z.object({ bookmark: Bookmark, alreadyExists: z.literal(true) }), 'URL was already saved'),
				...errors,
			},
		}),
		async (c) => {
			const result = await createBookmark(c.env.DB, c.req.valid('json'));
			return result.alreadyExists
				? c.json({ bookmark: result.bookmark, alreadyExists: true as const }, 200)
				: c.json({ bookmark: result.bookmark, alreadyExists: false as const }, 201);
		},
	)
	.openapi(
		createRoute({
			method: 'get',
			path: '/api/v1/bookmarks/needs-og',
			summary: 'Links waiting for previews',
			description: 'Used by the browser extension to fetch OpenGraph previews from the browser.',
			request: { query: z.object({ limit: z.coerce.number().int().min(1).max(LIMITS.ogBatch).default(LIMITS.ogBatch) }) },
			responses: { 200: json(z.object({ items: z.array(z.object({ id: z.string(), url: z.string() })) }), 'Links waiting for previews'), ...errors },
		}),
		async (c) => c.json({ items: await needsOg(c.env.DB, c.req.valid('query').limit) }, 200),
	)
	.openapi(
		createRoute({
			method: 'get',
			path: '/api/v1/bookmarks/{id}',
			summary: 'Get a bookmark',
			description: '',
			request: { params: IdParam },
			responses: { 200: json(Bookmark, 'The bookmark'), 404: json(ApiError, 'Not found'), ...errors },
		}),
		async (c) => {
			const bookmark = await getBookmark(c.env.DB, c.req.valid('param').id);
			return bookmark ? c.json(bookmark, 200) : c.json({ error: 'not_found' }, 404);
		},
	)
	.openapi(
		createRoute({
			method: 'patch',
			path: '/api/v1/bookmarks/{id}',
			summary: 'Update a bookmark',
			description: 'Edit title, note or text; favourite or archive. Editing the title stops previews from overwriting it.',
			request: { params: IdParam, body: { content: { 'application/json': { schema: PatchBookmark } }, required: true } },
			responses: { 200: json(Bookmark, 'Updated'), 404: json(ApiError, 'Not found'), ...errors },
		}),
		async (c) => {
			const bookmark = await patchBookmark(c.env.DB, c.req.valid('param').id, c.req.valid('json'));
			return bookmark ? c.json(bookmark, 200) : c.json({ error: 'not_found' }, 404);
		},
	)
	.openapi(
		createRoute({
			method: 'put',
			path: '/api/v1/bookmarks/{id}/og',
			summary: 'Write preview data',
			description: 'Extension-supplied OpenGraph data. Ignored when a higher-priority source (the open tab, a bookmarklet) already set it.',
			request: { params: IdParam, body: { content: { 'application/json': { schema: OgPatch } }, required: true } },
			responses: { 200: json(z.object({ applied: z.boolean() }), 'Applied unless a higher-priority source already set it'), ...errors },
		}),
		async (c) => {
			const { id } = c.req.valid('param');
			const body = c.req.valid('json');
			if (body.failed) {
				await markOgFailed(c.env.DB, id, 'extension');
				return c.json({ applied: false }, 200);
			}
			return c.json({ applied: await applyOg(c.env.DB, id, body, 'extension') }, 200);
		},
	)
	.openapi(
		createRoute({
			method: 'delete',
			path: '/api/v1/bookmarks/{id}',
			summary: 'Delete a bookmark',
			description: '',
			request: { params: IdParam },
			responses: { 204: { description: 'Deleted' }, 404: json(ApiError, 'Not found'), ...errors },
		}),
		async (c) => ((await deleteBookmark(c.env.DB, c.req.valid('param').id)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404)),
	)
	.openapi(
		createRoute({
			method: 'get',
			path: '/api/v1/lists',
			summary: 'All lists',
			description: 'Every list, sorted by name. Nesting comes from `parentId`; `itemCount` is kept up to date for manual lists.',
			responses: { 200: json(z.object({ items: z.array(List) }), 'Lists'), ...errors },
		}),
		async (c) => c.json({ items: await allLists(c.env.DB) }, 200),
	)
	.openapi(
		createRoute({
			method: 'post',
			path: '/api/v1/lists',
			summary: 'Create a list',
			description: 'A manual list holds the bookmarks you add to it; a smart list (`kind: "smart"`) shows whatever matches its `query`.',
			request: { body: { content: { 'application/json': { schema: CreateList } }, required: true } },
			responses: { 201: json(List, 'Created'), ...errors },
		}),
		async (c) => c.json(await createList(c.env.DB, c.req.valid('json')), 201),
	)
	.openapi(
		createRoute({
			method: 'patch',
			path: '/api/v1/lists/{id}',
			summary: 'Update a list',
			description: 'Rename, change the icon, move under another list (`parentId`, or null for the top level), or change a smart list\'s query.',
			request: { params: IdParam, body: { content: { 'application/json': { schema: PatchList } }, required: true } },
			responses: { 200: json(List, 'Updated'), 404: json(ApiError, 'Not found'), ...errors },
		}),
		async (c) => c.json(await patchList(c.env.DB, c.req.valid('param').id, c.req.valid('json')), 200),
	)
	.openapi(
		createRoute({
			method: 'delete',
			path: '/api/v1/lists/{id}',
			summary: 'Delete a list',
			description: 'Removes the list only; its bookmarks stay. Child lists move to the top level.',
			request: { params: IdParam },
			responses: { 204: { description: 'Deleted' }, 404: json(ApiError, 'Not found'), ...errors },
		}),
		async (c) => ((await deleteList(c.env.DB, c.req.valid('param').id)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404)),
	)
	.openapi(
		createRoute({
			method: 'put',
			path: '/api/v1/lists/{id}/bookmarks/{bookmarkId}',
			summary: 'Add a bookmark to a list',
			description: 'Manual lists only. Adding a bookmark that is already in the list does nothing.',
			request: { params: z.object({ id: z.string().max(64), bookmarkId: z.string().max(64) }) },
			responses: { 204: { description: 'Added' }, 404: json(ApiError, 'Not found'), ...errors },
		}),
		async (c) => {
			const { id, bookmarkId } = c.req.valid('param');
			await addToList(c.env.DB, id, bookmarkId);
			return c.body(null, 204);
		},
	)
	.openapi(
		createRoute({
			method: 'delete',
			path: '/api/v1/lists/{id}/bookmarks/{bookmarkId}',
			summary: 'Remove a bookmark from a list',
			description: 'The bookmark itself stays.',
			request: { params: z.object({ id: z.string().max(64), bookmarkId: z.string().max(64) }) },
			responses: { 204: { description: 'Removed' }, 404: json(ApiError, 'Not found'), ...errors },
		}),
		async (c) => {
			const { id, bookmarkId } = c.req.valid('param');
			await removeFromList(c.env.DB, id, bookmarkId);
			return c.body(null, 204);
		},
	);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

// Public privacy policy for the Chrome Web Store listing (served by the Worker, not the SPA).
app.get('/privacy-policy', (c) => c.text(privacyPolicy, 200, { 'content-type': 'text/markdown; charset=utf-8' }));

export type AppType = typeof routes;
