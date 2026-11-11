// End-to-end API check. Usage: BASE_URL=http://localhost:5173 SECRET=... bun scripts/smoke.ts
// Defaults to local dev with the secret from .dev.vars. Cleans up what it creates.
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SECRET =
	process.env.SECRET ?? /^ZEROSTASH_SECRET=(.*)$/m.exec(readFileSync('.dev.vars', 'utf8'))?.[1]?.trim() ?? '';
const auth = { authorization: `Bearer ${SECRET}` };
const run = Date.now();
const created: string[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` → ${JSON.stringify(detail)}`}`);
	if (!ok) failures++;
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = auth) {
	const res = await fetch(`${BASE}/api/v1${path}`, {
		method,
		headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = res.status === 204 ? null : await res.json().catch(() => null);
	return { status: res.status, json, res };
}

async function create(body: Record<string, unknown>) {
	const r = await call('POST', '/bookmarks', body);
	if (r.json?.bookmark?.id && !r.json.alreadyExists) created.push(r.json.bookmark.id);
	return r;
}

const health = await call('GET', '/health', undefined, {});
check('health is public', health.status === 200 && health.json?.name === 'zerostash' && !health.json.setupRequired, health.json);

check('no credentials → 401', (await call('GET', '/me', undefined, {})).status === 401);
check('wrong bearer → 401', (await call('GET', '/me', undefined, { authorization: 'Bearer nope' })).status === 401);
check('wrong login → 401', (await call('POST', '/auth/login', { secret: 'nope' }, {})).status === 401);
const login = await call('POST', '/auth/login', { secret: SECRET }, {});
const cookie = login.res.headers.get('set-cookie') ?? '';
check('login sets HttpOnly Strict cookie', login.status === 204 && /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie), cookie);
check('cookie authenticates', (await call('GET', '/me', undefined, { cookie: cookie.split(';')[0] })).status === 200);
check('bearer authenticates', (await call('GET', '/me')).status === 200);

const pre = (origin: string) =>
	fetch(`${BASE}/api/v1/bookmarks`, {
		method: 'OPTIONS',
		headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
	});
const ext = await pre('chrome-extension://abcdefghijklmnop');
check('CORS allows extension origin', ext.headers.get('access-control-allow-origin') === 'chrome-extension://abcdefghijklmnop');
const evil = await pre('https://evil.example');
check('CORS rejects other origins', !evil.headers.get('access-control-allow-origin'));

const url = `https://example.com/smoke-${run}`;
const a = await create({ type: 'link', url, source: 'extension', og: { source: 'tab', title: 'Tab title', imageUrl: 'https://example.com/i.png' } });
check('create link with tab OG → 201', a.status === 201 && a.json.bookmark.ogSource === 'tab' && a.json.bookmark.ogStatus === 'done', a.json);
const dup = await create({ type: 'link', url, source: 'web' });
check('duplicate URL → 200 alreadyExists', dup.status === 200 && dup.json.alreadyExists && dup.json.bookmark.id === a.json.bookmark.id, dup.json);
check('javascript: URL rejected', (await create({ type: 'link', url: 'javascript:alert(1)' })).status === 400);
check('over-length title rejected', (await create({ type: 'link', url: `${url}/long`, title: 'x'.repeat(501) })).status === 400);
check('og:image must be http(s)', (await create({ type: 'link', url: `${url}/img`, og: { source: 'tab', imageUrl: 'data:x' } })).status === 400);

const lower = await call('PUT', `/bookmarks/${a.json.bookmark.id}/og`, { source: 'extension', title: 'Background title' });
check('extension OG cannot overwrite tab OG', lower.json?.applied === false, lower.json);

const b = await create({ type: 'link', url: `${url}/pending`, source: 'web' });
check('link without OG is pending', b.json?.bookmark.ogStatus === 'pending', b.json);
const todo = await call('GET', '/bookmarks/needs-og?limit=20');
check('needs-og lists it', todo.json?.items.some((i: { id: string }) => i.id === b.json.bookmark.id), todo.json);
await call('PATCH', `/bookmarks/${b.json.bookmark.id}`, { title: 'My own title' });
const bg = await call('PUT', `/bookmarks/${b.json.bookmark.id}/og`, { source: 'extension', title: 'OG title', description: 'OG desc' });
const afterBg = await call('GET', `/bookmarks/${b.json.bookmark.id}`);
check(
	'extension OG applies but keeps user-edited title',
	bg.json?.applied && afterBg.json.ogSource === 'extension' && afterBg.json.title === 'My own title' && afterBg.json.description === 'OG desc',
	afterBg.json,
);

const c = await create({ type: 'link', url: `${url}/fail`, source: 'web' });
for (let i = 0; i < 3; i++) await call('PUT', `/bookmarks/${c.json.bookmark.id}/og`, { source: 'extension', failed: true });
check('3 failed OG attempts → failed', (await call('GET', `/bookmarks/${c.json.bookmark.id}`)).json?.ogStatus === 'failed');

const note = await create({ type: 'text', text: 'a quick note', source: 'web' });
check('text bookmark', note.status === 201 && note.json.bookmark.ogStatus === 'done', note.json);

const fav = await call('PATCH', `/bookmarks/${note.json.bookmark.id}`, { favourited: true });
check('favourite', fav.json?.favourited === true);
const favs = await call('GET', '/bookmarks?view=favourites');
check('favourites view', favs.json?.items.some((i: { id: string }) => i.id === note.json.bookmark.id));

const page1 = await call('GET', '/bookmarks?limit=2');
const page2 = await call('GET', `/bookmarks?limit=2&cursor=${encodeURIComponent(page1.json?.nextCursor)}`);
check(
	'cursor pagination has no overlap',
	page1.json?.items.length === 2 && page2.json?.items.length >= 1 && !page2.json.items.some((x: { id: string }) => page1.json.items.some((y: { id: string }) => y.id === x.id)),
	{ page1: page1.json?.items.map((x: { id: string }) => x.id), page2: page2.json?.items.map((x: { id: string }) => x.id) },
);

for (const id of created) await call('DELETE', `/bookmarks/${id}`);
check('delete → gone', (await call('GET', `/bookmarks/${a.json.bookmark.id}`)).status === 404);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
