// Zerostash service worker. Keeps the app shell (the page plus its hashed /assets files) so
// the dashboard opens instantly, and offline. Bookmarks live in IndexedDB (web/lib/idb.ts);
// /api/* and every other request go to the network untouched.
const CACHE = 'zerostash-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
			await self.clients.claim();
		})(),
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);
	if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
	// Every app route serves the same single-page shell; /privacy-policy is rendered by the Worker.
	if (req.mode === 'navigate' && url.pathname !== '/privacy-policy') event.respondWith(shell(event));
	else if (url.pathname.startsWith('/assets/')) event.respondWith(asset(req));
});

// Cached shell at once; the network refreshes it for the next visit (stale-while-revalidate),
// so a deploy shows up one load later. Safe because the build is one JS and one CSS file with
// no lazy chunks: a cached page always has its own assets cached alongside.
async function shell(event) {
	const cache = await caches.open(CACHE);
	const network = fetch(event.request).then(async (res) => {
		if (res.ok && res.type === 'basic' && res.headers.get('content-type')?.includes('text/html')) {
			const html = await res.clone().text();
			await cache.put('/', res.clone());
			// Drop assets the new page no longer uses (the previous deploy's files).
			for (const key of await cache.keys()) {
				const path = new URL(key.url).pathname;
				if (path.startsWith('/assets/') && !html.includes(path)) await cache.delete(key);
			}
		}
		return res;
	});
	const cached = await cache.match('/');
	if (!cached) return network;
	event.waitUntil(network.catch(() => {}));
	return cached;
}

// Hashed file names never change content: cache first.
async function asset(req) {
	const cache = await caches.open(CACHE);
	const hit = await cache.match(req);
	if (hit) return hit;
	const res = await fetch(req);
	if (res.ok) await cache.put(req, res.clone());
	return res;
}
