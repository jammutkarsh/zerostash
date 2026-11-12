import { OpenAPIHono } from '@hono/zod-openapi';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import pkg from '../package.json';
import { API_VERSION } from '../shared/schemas';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, secretConfigured, secretMatches, signSession, verifySession } from './auth';
import { applyOg, changesSince, createBookmark, deleteBookmark, getBookmark, listBookmarks, markOgFailed, needsOg, patchBookmark } from './bookmarks';
import { addToList, allLists, createList, deleteList, getList, ListError, patchList, removeFromList } from './lists';
import privacyPolicy from './privacy-policy.md?raw';
import * as r from './routes';

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

// Route contracts (paths, inputs, responses) are in routes.ts; these are the handlers.
app.openapi(r.health, (c) =>
	c.json({ name: 'zerostash' as const, version: pkg.version, apiVersion: API_VERSION, setupRequired: !secretConfigured(c.env.ZEROSTASH_SECRET) }, 200),
);

app.openapi(r.login, async (c) => {
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
});

app.openapi(r.logout, (c) => {
	deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
	return c.body(null, 204);
});

app.openapi(r.me, (c) => c.json({ ok: true as const, version: pkg.version, apiVersion: API_VERSION }, 200));

app.openapi(r.changes, async (c) => {
	const [lists, delta] = await Promise.all([allLists(c.env.DB), changesSince(c.env.DB, c.req.valid('query').since)]);
	return c.json({ ...delta, lists }, 200);
});

app.openapi(r.listBookmarks, async (c) => {
	const query = c.req.valid('query');
	const list = query.list ? await getList(c.env.DB, query.list) : undefined;
	if (query.list && !list) return c.json({ error: 'not_found', message: 'List not found.' }, 404);
	return c.json(await listBookmarks(c.env.DB, { ...query, list: list ?? undefined }), 200);
});

app.openapi(r.createBookmark, async (c) => {
	const result = await createBookmark(c.env.DB, c.req.valid('json'));
	return result.alreadyExists
		? c.json({ bookmark: result.bookmark, alreadyExists: true as const }, 200)
		: c.json({ bookmark: result.bookmark, alreadyExists: false as const }, 201);
});

app.openapi(r.needsOg, async (c) => c.json({ items: await needsOg(c.env.DB, c.req.valid('query').limit) }, 200));

app.openapi(r.getBookmark, async (c) => {
	const bookmark = await getBookmark(c.env.DB, c.req.valid('param').id);
	return bookmark ? c.json(bookmark, 200) : c.json({ error: 'not_found' }, 404);
});

app.openapi(r.patchBookmark, async (c) => {
	const bookmark = await patchBookmark(c.env.DB, c.req.valid('param').id, c.req.valid('json'));
	return bookmark ? c.json(bookmark, 200) : c.json({ error: 'not_found' }, 404);
});

app.openapi(r.putOg, async (c) => {
	const { id } = c.req.valid('param');
	const body = c.req.valid('json');
	if (body.failed) {
		await markOgFailed(c.env.DB, id, 'extension');
		return c.json({ applied: false }, 200);
	}
	return c.json({ applied: await applyOg(c.env.DB, id, body, 'extension') }, 200);
});

app.openapi(r.deleteBookmark, async (c) =>
	(await deleteBookmark(c.env.DB, c.req.valid('param').id)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404),
);

app.openapi(r.allLists, async (c) => c.json({ items: await allLists(c.env.DB) }, 200));

app.openapi(r.createList, async (c) => c.json(await createList(c.env.DB, c.req.valid('json')), 201));

app.openapi(r.patchList, async (c) => c.json(await patchList(c.env.DB, c.req.valid('param').id, c.req.valid('json')), 200));

app.openapi(r.deleteList, async (c) =>
	(await deleteList(c.env.DB, c.req.valid('param').id)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404),
);

app.openapi(r.addToList, async (c) => {
	const { id, bookmarkId } = c.req.valid('param');
	await addToList(c.env.DB, id, bookmarkId);
	return c.body(null, 204);
});

app.openapi(r.removeFromList, async (c) => {
	const { id, bookmarkId } = c.req.valid('param');
	await removeFromList(c.env.DB, id, bookmarkId);
	return c.body(null, 204);
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

// Public privacy policy for the Chrome Web Store listing (served by the Worker, not the SPA).
app.get('/privacy-policy', (c) => c.text(privacyPolicy, 200, { 'content-type': 'text/markdown; charset=utf-8' }));

