// End-to-end API check against a running server, using the same client stack as Karakeep's
// extension and mobile app (tRPC httpBatchLink + superjson).
// Usage: BASE_URL=http://localhost:5173 SECRET=... bun scripts/smoke.ts
// Defaults to local dev with the secret from .dev.vars. Cleans up what it creates.
import { readFileSync } from 'node:fs';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../server/trpc';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SECRET = process.env.SECRET ?? /^ZEROSTASH_SECRET=(.*)$/m.exec(readFileSync('.dev.vars', 'utf8'))?.[1]?.trim() ?? '';
const run = Date.now();
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` → ${JSON.stringify(detail)}`}`);
	if (!ok) failures++;
}

const client = (headers: Record<string, string>) =>
	createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${BASE}/api/trpc`, transformer: superjson, headers: () => headers })] });
const k = client({ authorization: `Bearer ${SECRET}` });
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => e?.data?.code ?? String(e));

// ---- reachability, auth ----
const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
check('health', health.status === 'ok' && health.name === 'zerostash' && !health.setupRequired, health);
const pre = await fetch(`${BASE}/api/trpc/users.whoami`, {
	method: 'OPTIONS',
	headers: { origin: 'chrome-extension://abc', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,x-custom' },
});
check('CORS preflight for extensions', pre.headers.get('access-control-allow-origin') === 'chrome-extension://abc');
const evil = await fetch(`${BASE}/api/trpc/users.whoami`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
check('no CORS for web origins', !evil.headers.get('access-control-allow-origin'));
check('no key → UNAUTHORIZED', (await code(client({}).users.whoami.query())) === 'UNAUTHORIZED');
check('wrong key → UNAUTHORIZED', (await code(client({ authorization: 'Bearer nope' }).users.whoami.query())) === 'UNAUTHORIZED');
check('bad API key rejected', (await code(k.apiKeys.validate.mutate({ apiKey: 'nope' }))) === 'UNAUTHORIZED');
check('wrong password rejected', (await code(k.apiKeys.exchange.mutate({ keyName: 'smoke', email: 'a@b.c', password: 'nope' }))) === 'UNAUTHORIZED');
const exchanged = await k.apiKeys.exchange.mutate({ keyName: 'smoke', email: 'any@b.c', password: SECRET });
check('password login hands out a working key', (await client({ authorization: `Bearer ${exchanged.key}` }).apiKeys.validate.mutate({ apiKey: exchanged.key })).success);
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', body: JSON.stringify({ secret: SECRET }), headers: { 'content-type': 'application/json' } });
const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
check('web login sets an HttpOnly session cookie', login.status === 204 && /HttpOnly/i.test(login.headers.get('set-cookie') ?? ''));
check('cookie session works', (await client({ cookie }).users.whoami.query()).id === 'owner');
check('bad web login → 401', (await fetch(`${BASE}/api/auth/login`, { method: 'POST', body: '{"secret":"nope"}' })).status === 401);
check('settings defaults', (await k.users.settings.query()).archiveDisplayBehaviour === 'show');
check('client config', (await k.config.clientConfig.query()).auth.disableSignups === true);

// ---- bookmarks ----
const url = `https://example.com/smoke-${run}`;
const t0 = Date.now() - 5000; // margin for clock skew between this machine and the server
const kb = await k.bookmarks.createBookmark.mutate({ type: 'link', url, title: 'Tab title', source: 'extension', favourited: true });
check('create → Date fields, flags, title', kb.createdAt instanceof Date && !kb.alreadyExists && kb.favourited && kb.title === 'Tab title', kb);
check('duplicate URL → alreadyExists', (await k.bookmarks.createBookmark.mutate({ type: 'link', url })).alreadyExists);
check('checkUrl', (await k.bookmarks.checkUrl.query({ url })).bookmarkId === kb.id);
check('bad URL refused', (await code(k.bookmarks.createBookmark.mutate({ type: 'link', url: 'ftp://x' }))) === 'BAD_REQUEST');
const text = await k.bookmarks.createBookmark.mutate({ type: 'text', text: `smoke note ${run}`, source: 'web' });
await k.bookmarks.updateBookmarkText.mutate({ bookmarkId: text.id, text: `edited note ${run}` });
check('text bookmark edit', (await k.bookmarks.getBookmark.query({ bookmarkId: text.id })).content.type === 'text');

// ---- tags ----
await k.bookmarks.updateTags.mutate({ bookmarkId: kb.id, attach: [{ tagName: `smoke-${run}` }], detach: [] });
const [tagged, tags] = await Promise.all([k.bookmarks.getBookmark.query({ bookmarkId: kb.id }), k.tags.list.query({ nameContains: `smoke-${run}` })]);
check('tags attach + list', tagged.tags[0]?.name === `smoke-${run}` && tags.tags[0]?.numBookmarks === 1, { tagged, tags });
check('tag feed', (await k.bookmarks.getBookmarks.query({ tagId: tags.tags[0].id })).bookmarks[0]?.id === kb.id);

// ---- lists ----
const manual = await k.lists.create.mutate({ name: `smoke-${run}`, icon: '📁' });
const smart = await k.lists.create.mutate({ name: `smart-${run}`, icon: '🔎', type: 'smart', query: `#smoke-${run} or "edited note ${run}"` });
await k.lists.addToList.mutate({ listId: manual.id, bookmarkId: kb.id });
// Three queries in one batched HTTP request, as Karakeep's popup does.
const [all, ofBookmark, stats] = await Promise.all([k.lists.list.query(), k.lists.getListsOfBookmark.query({ bookmarkId: kb.id }), k.lists.stats.query()]);
check(
	'lists, membership, stats (Map)',
	all.lists.some((l) => l.id === manual.id) && ofBookmark.lists[0]?.id === manual.id && stats.stats.get(manual.id) === 1 && stats.stats.get(smart.id) === 2,
	{ ofBookmark, stats: [...stats.stats] },
);
check('smart list feed', (await k.bookmarks.getBookmarks.query({ listId: smart.id })).bookmarks.length === 2);
await k.lists.removeFromList.mutate({ listId: manual.id, bookmarkId: kb.id });
check('remove from list', (await k.lists.getListsOfBookmark.query({ bookmarkId: kb.id })).lists.length === 0);
check('missing list → NOT_FOUND', (await code(k.lists.addToList.mutate({ listId: 'nope', bookmarkId: kb.id }))) === 'NOT_FOUND');

// ---- updates, feeds, search, sync ----
const upd = await k.bookmarks.updateBookmark.mutate({ bookmarkId: kb.id, note: 'from smoke', archived: true });
check('update note + archive', upd.note === 'from smoke' && upd.archived, upd);
check('archived feed', (await k.bookmarks.getBookmarks.query({ archived: true, limit: 100 })).bookmarks.some((b) => b.id === kb.id));
check('search (query language)', (await k.bookmarks.searchBookmarks.query({ text: `is:fav #smoke-${run}` })).bookmarks[0]?.id === kb.id);
const changes = await k.zerostash.changes.query({ since: t0 });
check('delta sync carries the changes', !changes.reset && changes.bookmarks.some((b) => b.id === kb.id) && changes.lists.some((l) => l.id === smart.id), changes.reset);
check('unsupported procedure → 404', (await fetch(`${BASE}/api/trpc/backups.list`, { headers: { authorization: `Bearer ${SECRET}` } })).status === 404);

// ---- Karakeep REST API (/api/v1) ----
const rest = async (method: string, path: string, body?: unknown, auth = true) => {
	const res = await fetch(`${BASE}/api/v1${path}`, {
		method,
		headers: { ...(auth ? { authorization: `Bearer ${SECRET}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
};
check('REST: no key → 401', (await rest('GET', '/bookmarks', undefined, false)).status === 401);
const restUrl = `https://example.com/rest-${run}`;
const created = await rest('POST', '/bookmarks', { type: 'link', url: restUrl, title: 'From REST' });
check('REST: create → 201', created.status === 201 && created.json?.content?.url === restUrl && typeof created.json?.createdAt === 'string', created);
const rid = created.json.id as string;
check('REST: duplicate → 200 same id', (await rest('POST', '/bookmarks', { type: 'link', url: restUrl })).json?.id === rid);
check('REST: invalid body → 400 {code, message}', (await rest('POST', '/bookmarks', { type: 'link' })).json?.code === 'BadRequest');
check('REST: check-url', (await rest('GET', `/bookmarks/check-url?url=${encodeURIComponent(restUrl)}`)).json?.bookmarkId === rid);
check('REST: missing → 404 {code}', (await rest('GET', '/bookmarks/nope')).json?.code === 'NOT_FOUND');
check('REST: patch', (await rest('PATCH', `/bookmarks/${rid}`, { favourited: true, note: 'rest note' })).json?.favourited === true);
check('REST: attach tags', (await rest('POST', `/bookmarks/${rid}/tags`, { tags: [{ tagName: `rest-${run}` }] })).json?.attached?.length === 1);
check('REST: search', (await rest('GET', `/bookmarks/search?q=${encodeURIComponent(`#rest-${run} is:fav`)}`)).json?.bookmarks?.[0]?.id === rid);
check('REST: list page', (await rest('GET', '/bookmarks?favourited=true&limit=100')).json?.bookmarks?.some((b: { id: string }) => b.id === rid));
const rlist = await rest('POST', '/lists', { name: `rest-${run}`, icon: '📁' });
check('REST: create list', rlist.status === 201);
check('REST: add to list', (await rest('PUT', `/lists/${rlist.json.id}/bookmarks/${rid}`)).status === 204);
check('REST: list bookmarks', (await rest('GET', `/lists/${rlist.json.id}/bookmarks`)).json?.bookmarks?.[0]?.id === rid);
check('REST: lists of bookmark', (await rest('GET', `/bookmarks/${rid}/lists`)).json?.lists?.[0]?.id === rlist.json.id);
const rtag = (await rest('GET', `/tags?nameContains=rest-${run}`)).json?.tags?.[0];
check('REST: tag + tag bookmarks', rtag?.numBookmarks === 1 && (await rest('GET', `/tags/${rtag.id}/bookmarks`)).json?.bookmarks?.[0]?.id === rid);
check('REST: detach tags', (await rest('DELETE', `/bookmarks/${rid}/tags`, { tags: [{ tagId: rtag.id }] })).json?.detached?.[0] === rtag.id);
check('REST: users/me + stats', (await rest('GET', '/users/me')).json?.id === 'owner' && typeof (await rest('GET', '/users/me/stats')).json?.numBookmarks === 'number');
check('REST write is visible over tRPC', (await k.bookmarks.getBookmark.query({ bookmarkId: rid })).note === 'rest note');
check('REST write is in delta sync', (await k.zerostash.changes.query({ since: t0 })).bookmarks.some((b) => b.id === rid));
check('openapi.json is served', (await fetch(`${BASE}/openapi.json`).then((r) => r.json()).catch(() => null))?.paths?.['/bookmarks'] !== undefined);
await rest('DELETE', `/tags/${rtag.id}`);
await rest('DELETE', `/lists/${rlist.json.id}`);
check('REST: delete → 204', (await rest('DELETE', `/bookmarks/${rid}`)).status === 204);

// ---- files (R2) ----
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
const uploadTo = async (path: string, blob: Blob, name: string, auth = true) => {
	const form = new FormData();
	form.append('file', blob, name);
	const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form, headers: auth ? { authorization: `Bearer ${SECRET}` } : {} });
	return { status: res.status, json: await res.json().catch(() => null) };
};
check('upload without key → 401', (await uploadTo('/api/assets', new Blob([PNG], { type: 'image/png' }), 'x.png', false)).status === 401);
check('SVG refused', (await uploadTo('/api/assets', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg')).status === 400);
const up = await uploadTo('/api/assets', new Blob([PNG], { type: 'image/png' }), `smoke-${run}.png`);
check('upload (multipart, field "file")', up.status === 200 && up.json?.contentType === 'image/png' && up.json?.size === PNG.length, up);
const ab = await k.bookmarks.createBookmark.mutate({ type: 'asset', assetType: 'image', assetId: up.json.assetId, fileName: up.json.fileName });
check('asset bookmark', ab.content.type === 'asset' && ab.assets[0]?.id === up.json.assetId, ab);
const file = await fetch(`${BASE}/api/assets/${up.json.assetId}`, { headers: { authorization: `Bearer ${SECRET}` } });
check('serve file', file.status === 200 && file.headers.get('content-type') === 'image/png' && (await file.arrayBuffer()).byteLength === PNG.length);
check('serve without key → 401', (await fetch(`${BASE}/api/assets/${up.json.assetId}`)).status === 401);
check('serve with session cookie', (await fetch(`${BASE}/api/assets/${up.json.assetId}`, { headers: { cookie } })).status === 200);
const pdf = await uploadTo('/api/v1/assets', new Blob(['%PDF-1.4 smoke'], { type: 'application/pdf' }), 'doc.pdf');
check('REST upload', pdf.status === 200 && pdf.json?.contentType === 'application/pdf', pdf);
const host = await k.bookmarks.createBookmark.mutate({ type: 'link', url: `https://example.com/with-file-${run}` });
check('attach file to a link', (await rest('POST', `/bookmarks/${host.id}/assets`, { id: pdf.json.assetId, assetType: 'userUploaded' })).status === 201);
check('detach file', (await rest('DELETE', `/bookmarks/${host.id}/assets/${pdf.json.assetId}`)).status === 204);
await k.bookmarks.deleteBookmark.mutate({ bookmarkId: ab.id });
await k.bookmarks.deleteBookmark.mutate({ bookmarkId: host.id });
check('deleting the bookmark deletes the file', (await fetch(`${BASE}/api/assets/${up.json.assetId}`, { headers: { authorization: `Bearer ${SECRET}` } })).status === 404);

// ---- rules, feeds, webhooks (run on the local queue) ----
const waitFor = async <T>(fn: () => Promise<T | undefined | null | false>, ms = 20_000): Promise<T | undefined> => {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
		const v = await fn();
		if (v) return v;
	}
};
const ruleTag = await k.tags.create.mutate({ name: `rule-${run}` });
const rule = await k.rules.create.mutate({
	name: `smoke-${run}`,
	event: { type: 'bookmarkAdded' },
	condition: { type: 'urlContains', str: `ruled-${run}` },
	actions: [{ type: 'addTag', tagId: ruleTag.id }, { type: 'favouriteBookmark' }],
});
const ruled = await k.bookmarks.createBookmark.mutate({ type: 'link', url: `https://example.com/ruled-${run}` });
const afterRule = await waitFor(async () => {
	const b = await k.bookmarks.getBookmark.query({ bookmarkId: ruled.id });
	return b.tags.some((t) => t.id === ruleTag.id) && b.favourited && b;
});
check('rule ran on the queue (tag + favourite)', !!afterRule, afterRule);
await k.rules.delete.mutate({ id: rule.id });
await k.bookmarks.deleteBookmark.mutate({ bookmarkId: ruled.id });
await k.tags.delete.mutate({ tagId: ruleTag.id });

const hook = await k.webhooks.create.mutate({ url: 'https://example.com/hook', events: ['created'], token: 't' });
check('webhook CRUD', hook.hasToken && (await k.webhooks.list.query()).webhooks.some((w) => w.id === hook.id));
await k.webhooks.delete.mutate({ webhookId: hook.id });

const feed = await k.feeds.create.mutate({ name: 'Cloudflare blog', url: 'https://blog.cloudflare.com/rss/', enabled: true, importTags: false });
check('duplicate feed → CONFLICT', (await code(k.feeds.create.mutate({ name: 'x', url: 'https://blog.cloudflare.com/rss/', enabled: true, importTags: false }))) === 'CONFLICT');
await k.feeds.fetchNow.mutate({ feedId: feed.id });
const fetched = await waitFor(async () => {
	const f = await k.feeds.get.query({ feedId: feed.id });
	return f.lastFetchedStatus === 'success' && f;
}, 30_000);
const items = await k.bookmarks.getBookmarks.query({ rssFeedId: feed.id, limit: 100 });
check('feed fetched; items saved as rss bookmarks', !!fetched && items.bookmarks.length > 0 && items.bookmarks.every((b) => b.source === 'rss' && b.feedId === feed.id), { fetched, n: items.bookmarks.length });
check('feed: search by feed name', (await k.bookmarks.searchBookmarks.query({ text: 'feed:"Cloudflare blog"', limit: 100 })).bookmarks.length === items.bookmarks.length);
for (const b of items.bookmarks) await k.bookmarks.deleteBookmark.mutate({ bookmarkId: b.id });
await k.feeds.delete.mutate({ feedId: feed.id });
check('REST feeds list', (await rest('GET', '/feeds')).status === 200);

// ---- cleanup ----
for (const id of [kb.id, text.id]) await k.bookmarks.deleteBookmark.mutate({ bookmarkId: id });
for (const id of [manual.id, smart.id]) await k.lists.delete.mutate({ listId: id });
await k.tags.delete.mutate({ tagId: tags.tags[0].id });
check('delete → NOT_FOUND', (await code(k.bookmarks.getBookmark.query({ bookmarkId: kb.id }))) === 'NOT_FOUND');
check('deletes come back as tombstones', (await k.zerostash.changes.query({ since: t0 })).deleted.includes(kb.id));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
