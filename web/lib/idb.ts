// The browser's own database (IndexedDB) holding the local copy of every bookmark.
// localStorage is too small for it: text notes alone can be 20,000 characters each.
// Every call fails soft: without IndexedDB the app still works, it just downloads again.
import type { Bookmark, List } from '../../shared/schemas';

export interface Meta {
	since?: number; // GET /changes cursor; set only once the download finished
	lists?: List[];
}

const DB = 'zerostash';
let opened: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
	opened ??= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore('bookmarks', { keyPath: 'id' });
			req.result.createObjectStore('meta');
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return opened;
}

const done = (tx: IDBTransaction) =>
	new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = tx.onabort = () => reject(tx.error);
	});

export async function load(): Promise<{ bookmarks: Bookmark[]; meta: Meta }> {
	try {
		const tx = (await open()).transaction(['bookmarks', 'meta']);
		const all = tx.objectStore('bookmarks').getAll();
		const meta = tx.objectStore('meta').get('meta');
		await done(tx);
		return { bookmarks: all.result as Bookmark[], meta: (meta.result as Meta | undefined) ?? {} };
	} catch {
		return { bookmarks: [], meta: {} };
	}
}

/** One transaction, so the bookmarks and the sync cursor describing them stay in step. */
export async function save(put: Bookmark[], del: string[], meta: Meta): Promise<void> {
	try {
		const tx = (await open()).transaction(['bookmarks', 'meta'], 'readwrite');
		const store = tx.objectStore('bookmarks');
		for (const b of put) store.put(b);
		for (const id of del) store.delete(id);
		tx.objectStore('meta').put(meta, 'meta');
		await done(tx);
	} catch {}
}

export async function wipe(): Promise<void> {
	try {
		const tx = (await open()).transaction(['bookmarks', 'meta'], 'readwrite');
		tx.objectStore('bookmarks').clear();
		tx.objectStore('meta').clear();
		await done(tx);
	} catch {}
}
