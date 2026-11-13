// HTTP entry: /api/trpc (tRPC, Karakeep's procedure names), web session login, health.
// Static assets never reach the Worker (wrangler.jsonc run_worker_first: /api/* only).
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { z } from 'zod';
import pkg from '../package.json';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, secretConfigured, secretMatches, signSession, verifySession } from './auth';
import { DomainError } from './domain/util';
import { rest } from './rest';
import { serveAsset, storeUpload } from './service';
import { appRouter } from './trpc';

type AppEnv = { Bindings: Env };

export const app = new Hono<AppEnv>();

/** Bearer secret (Karakeep clients, scripts) or the web app's session cookie. */
export async function authenticate(c: Context<AppEnv>): Promise<boolean> {
	const secret = c.env.ZEROSTASH_SECRET;
	if (!secretConfigured(secret)) return false;
	const auth = c.req.header('authorization');
	if (auth?.startsWith('Bearer ')) return secretMatches(auth.slice(7), secret);
	return verifySession(getCookie(c, SESSION_COOKIE), secret);
}

// Karakeep's extension calls cross-origin with a Bearer key. Reflect extension origins only
// (a wildcard pattern isn't valid in Access-Control-Allow-Origin), no credentials. Request
// headers are reflected because Karakeep's extension lets users add custom headers.
app.use(
	'/api/*',
	cors({
		origin: (origin) => (/^(chrome|moz|safari-web)-extension:\/\//.test(origin) ? origin : null),
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		maxAge: 86400,
	}),
);

// Karakeep's mobile app probes this before signing in; the web app reads setupRequired.
app.get('/api/health', (c) =>
	c.json({
		status: 'ok',
		message: 'Zerostash is running',
		name: 'zerostash',
		version: pkg.version,
		setupRequired: !secretConfigured(c.env.ZEROSTASH_SECRET),
	}),
);

app.post('/api/auth/login', async (c) => {
	const secret = c.env.ZEROSTASH_SECRET;
	if (!secretConfigured(secret)) return c.json({ error: 'setup_required' }, 503);
	const body = z.object({ secret: z.string().max(1000) }).safeParse(await c.req.json().catch(() => null));
	if (!body.success || !(await secretMatches(body.data.secret, secret))) return c.json({ error: 'unauthorized' }, 401);
	setCookie(c, SESSION_COOKIE, await signSession(secret), { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: SESSION_TTL_SECONDS });
	return c.body(null, 204);
});

app.post('/api/auth/logout', (c) => {
	deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
	return c.body(null, 204);
});

// Files: Karakeep's clients upload to and load from /api/assets (outside /api/v1).
app.post('/api/assets', async (c) => {
	if (!(await authenticate(c))) return c.json({ code: 'Unauthorized', message: 'Missing or wrong API key.' }, 401);
	const form = await c.req.formData().catch(() => null);
	return c.json(await storeUpload({ env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) }, form?.get('file')), 200);
});
app.get('/api/assets/:id', async (c) => {
	if (!(await authenticate(c))) return c.json({ code: 'Unauthorized', message: 'Missing or wrong API key.' }, 401);
	return serveAsset(c.env, c.req.param('id'));
});

// Karakeep's REST API: Bearer key (or the web session cookie, so /api-docs "try it" works).
app.use('/api/v1/*', async (c, next) => {
	if (!secretConfigured(c.env.ZEROSTASH_SECRET)) return c.json({ code: 'SetupRequired', message: 'Set the ZEROSTASH_SECRET secret first.' }, 503);
	if (!(await authenticate(c))) return c.json({ code: 'Unauthorized', message: 'Missing or wrong API key.' }, 401);
	await next();
});
app.route('/api/v1', rest);

app.all('/api/trpc/*', async (c) => {
	const authed = await authenticate(c);
	return fetchRequestHandler({
		endpoint: '/api/trpc',
		req: c.req.raw,
		router: appRouter,
		createContext: () => ({
			env: c.env,
			waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p),
			origin: new URL(c.req.url).origin,
			setupRequired: !secretConfigured(c.env.ZEROSTASH_SECRET),
			authed,
			checkSecret: (given: string) => secretMatches(given, c.env.ZEROSTASH_SECRET),
		}),
		onError: ({ error, path }) => {
			if (error.code === 'INTERNAL_SERVER_ERROR') console.error(JSON.stringify({ msg: 'unhandled', path: `trpc:${path}`, error: String(error.cause ?? error) }));
		},
	});
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

const STATUS = { NOT_FOUND: 404, BAD_REQUEST: 400, CONFLICT: 409 } as const;
app.onError((err, c) => {
	if (err instanceof DomainError) return c.json({ code: err.code, message: err.message }, STATUS[err.code]);
	console.error(JSON.stringify({ msg: 'unhandled', path: c.req.path, error: String(err) }));
	return c.json({ error: 'internal', message: 'Something went wrong.' }, 500);
});
