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
	Health,
	LIMITS,
	ListQuery,
	OgPatch,
	PatchBookmark,
} from '../shared/schemas';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, secretConfigured, secretMatches, signSession, verifySession } from './auth';
import { applyOg, createBookmark, deleteBookmark, getBookmark, listBookmarks, markOgFailed, needsOg, patchBookmark } from './bookmarks';

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
		createRoute({ method: 'get', path: '/api/v1/health', responses: { 200: json(Health, 'Server info') } }),
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
		createRoute({ method: 'post', path: '/api/v1/auth/logout', responses: { 204: { description: 'Logged out' } } }),
		(c) => {
			deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
			return c.body(null, 204);
		},
	)
	.openapi(
		createRoute({
			method: 'get',
			path: '/api/v1/me',
			responses: { 200: json(z.object({ ok: z.literal(true), version: z.string(), apiVersion: z.number() }), 'Authenticated'), ...errors },
		}),
		(c) => c.json({ ok: true as const, version: pkg.version, apiVersion: API_VERSION }, 200),
	)
	.openapi(
		createRoute({
			method: 'get',
			path: '/api/v1/bookmarks',
			request: { query: ListQuery },
			responses: { 200: json(BookmarkPage, 'A page of bookmarks, newest first'), ...errors },
		}),
		async (c) => c.json(await listBookmarks(c.env.DB, c.req.valid('query')), 200),
	)
	.openapi(
		createRoute({
			method: 'post',
			path: '/api/v1/bookmarks',
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
			request: { query: z.object({ limit: z.coerce.number().int().min(1).max(LIMITS.ogBatch).default(LIMITS.ogBatch) }) },
			responses: { 200: json(z.object({ items: z.array(z.object({ id: z.string(), url: z.string() })) }), 'Links waiting for previews'), ...errors },
		}),
		async (c) => c.json({ items: await needsOg(c.env.DB, c.req.valid('query').limit) }, 200),
	)
	.openapi(
		createRoute({
			method: 'get',
			path: '/api/v1/bookmarks/{id}',
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
			request: { params: IdParam },
			responses: { 204: { description: 'Deleted' }, 404: json(ApiError, 'Not found'), ...errors },
		}),
		async (c) => ((await deleteBookmark(c.env.DB, c.req.valid('param').id)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404)),
	);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export type AppType = typeof routes;
