import { isHttpUrl, parseOg, type OgData } from '../../../shared/og';
import type { Bookmark, OgFields } from '../../../shared/schemas';
import { server } from './api';
import { getSettings, isOwnServer } from './settings';

/** Pick the fields the server accepts, dropping empty ones. */
export function ogFields(og: OgData): OgFields {
	const out: OgFields = {};
	for (const key of ['url', 'title', 'description', 'imageUrl', 'siteName', 'faviconUrl'] as const) if (og[key]) out[key] = og[key];
	return out;
}

/**
 * Read OpenGraph from the open tab. Runs with `activeTab` (granted by the click), sees the
 * final post-redirect page, and is parsed with the same parser the server uses.
 */
async function readTab(tabId: number): Promise<{ url: string; og: OgData } | null> {
	try {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId },
			func: () => ({ url: location.href, head: document.head?.outerHTML ?? '' }),
		});
		const page = result?.result as { url: string; head: string } | undefined;
		return page ? { url: page.url, og: parseOg(page.head, page.url) } : null;
	} catch {
		return null; // restricted pages (store, PDFs, browser UI) — the background/server path fills OG later
	}
}

/** Saves the tab, or returns null (silently) for the user's own Zerostash pages. */
export async function saveTab(tab: chrome.tabs.Tab): Promise<{ bookmark: Bookmark; alreadyExists: boolean } | null> {
	if (isOwnServer(tab.url, await getSettings())) return null;
	const page = tab.id !== undefined ? await readTab(tab.id) : null;
	const url = page?.url ?? tab.url;
	if (!isHttpUrl(url)) throw new Error('Only web pages (http:// and https://) can be saved.');
	if (isOwnServer(url, await getSettings())) return null;
	const og = page ? ogFields(page.og) : {};
	og.title ??= tab.title || undefined;
	const result = await server.create({ type: 'link', url, source: 'extension', og: page ? { source: 'tab', ...og } : undefined });
	if (result.bookmark.ogStatus === 'pending') void chrome.runtime.sendMessage({ type: 'enrich' }).catch(() => {});
	return result;
}

export async function saveLink(url: string) {
	if (!isHttpUrl(url)) throw new Error('Only http(s) links can be saved.');
	if (isOwnServer(url, await getSettings())) return null;
	const result = await server.create({ type: 'link', url, source: 'extension' });
	return result;
}

export async function saveSelection(text: string, tab?: chrome.tabs.Tab) {
	return server.create({
		type: 'text',
		text: text.slice(0, 20_000),
		title: tab?.title?.slice(0, 500) || undefined,
		note: isHttpUrl(tab?.url) ? `From ${tab.url}` : undefined,
		source: 'extension',
	});
}
