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

// ---- lists ----
const listsCreated: string[] = [];
async function createList(body: Record<string, unknown>) {
	const r = await call('POST', '/lists', body);
	if (r.json?.id) listsCreated.push(r.json.id);
	return r;
}
const parent = await createList({ name: `Smoke ${run}`, icon: '📚' });
check('create list', parent.status === 201 && parent.json.kind === 'manual' && parent.json.itemCount === 0, parent.json);
const child = await createList({ name: `Smoke child ${run}`, parentId: parent.json.id });
check('nested list', child.json?.parentId === parent.json.id, child.json);
check('list cannot be its own ancestor', (await call('PATCH', `/lists/${parent.json.id}`, { parentId: child.json.id })).status === 400);
check('smart list needs a term', (await call('POST', '/lists', { name: 'x', kind: 'smart', terms: [] })).status === 400);

const member = await create({ type: 'link', url: `${url}/listed`, source: 'web' });
const mid = member.json.bookmark.id;
await call('PUT', `/lists/${parent.json.id}/bookmarks/${mid}`);
await call('PUT', `/lists/${parent.json.id}/bookmarks/${mid}`); // idempotent
await call('PUT', `/lists/${child.json.id}/bookmarks/${mid}`);
const lists1 = await call('GET', '/lists');
const p1 = lists1.json?.items.find((l: { id: string }) => l.id === parent.json.id);
check('adding twice counts once', p1?.itemCount === 1, p1);
const inList = await call('GET', `/bookmarks?list=${parent.json.id}`);
check('list view shows its bookmarks', inList.json?.items.length === 1 && inList.json.items[0].id === mid, inList.json);
check('bookmark carries listIds', (await call('GET', `/bookmarks/${mid}`)).json?.listIds.length === 2);
await call('DELETE', `/lists/${parent.json.id}/bookmarks/${mid}`);
const p2 = (await call('GET', '/lists')).json?.items.find((l: { id: string }) => l.id === parent.json.id);
check('remove decrements count', p2?.itemCount === 0, p2);

await call('DELETE', `/bookmarks/${mid}`);
created.splice(created.indexOf(mid), 1);
const c2 = (await call('GET', '/lists')).json?.items.find((l: { id: string }) => l.id === child.json.id);
check('deleting a bookmark decrements its lists', c2?.itemCount === 0, c2);

const note2 = await create({ type: 'text', text: `zebra-${run} note`, source: 'web' });
const smart = await createList({ name: `Smart ${run}`, kind: 'smart', terms: [`smoke-${run}`, `zebra-${run}`, `smoke-${run}`] });
check('smart list dedupes terms', smart.json?.terms?.length === 2, smart.json);
const smartView = await call('GET', `/bookmarks?list=${smart.json.id}`);
check(
	'smart list matches any term',
	smartView.json?.items.some((b: { url: string }) => b.url?.includes(`smoke-${run}`)) && smartView.json.items.some((b: { id: string }) => b.id === note2.json.bookmark.id),
	smartView.json?.items.length,
);
check('11 terms rejected', (await call('PATCH', `/lists/${smart.json.id}`, { terms: Array.from({ length: 11 }, (_, i) => `t${i}`) })).status === 400);
const extra = await create({ type: 'text', text: `unrelated ${run}`, source: 'web' });
await call('PUT', `/lists/${smart.json.id}/bookmarks/${extra.json.bookmark.id}`);
check(
	'smart lists also hold bookmarks added by hand',
	(await call('GET', `/bookmarks?list=${smart.json.id}`)).json?.items.some((b: { id: string }) => b.id === extra.json.bookmark.id),
);
check('unknown list → 404', (await call('GET', '/bookmarks?list=nope')).status === 404);

await call('DELETE', `/lists/${parent.json.id}`);
const afterDelete = (await call('GET', '/lists')).json?.items;
check(
	'deleting a parent lifts its children',
	!afterDelete.some((l: { id: string }) => l.id === parent.json.id) && afterDelete.find((l: { id: string }) => l.id === child.json.id)?.parentId === null,
);
for (const id of listsCreated) await call('DELETE', `/lists/${id}`);

for (const id of created) await call('DELETE', `/bookmarks/${id}`);
check('delete → gone', (await call('GET', `/bookmarks/${a.json.bookmark.id}`)).status === 404);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
