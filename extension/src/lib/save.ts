import { isHttpUrl, parseOg, type OgData } from '../../../shared/og';
import type { Bookmark, Preview } from '../../../shared/schemas';
import { api } from './api';
import { getSettings, isOwnServer } from './settings';

/**
 * The server's preview fields, keeping only values it accepts (an invalid image address mustn't
 * fail the whole save). Plain checks rather than the zod schema: zod would triple the popup's
 * JavaScript. Limits mirror Preview in shared/schemas.ts.
 */
export function previewOf(og: OgData): Preview {
	const text = (v: string | undefined, max: number) => v?.trim().slice(0, max) || undefined;
	const link = (v: string | undefined) => (v && v.length <= 2048 && isHttpUrl(v) ? v : undefined);
	const out: Preview = {
		title: text(og.title, 500),
		description: text(og.description, 2000),
		imageUrl: link(og.imageUrl),
		siteName: text(og.siteName, 200),
		faviconUrl: link(og.faviconUrl),
		author: text(og.author, 200),
	};
	for (const key of Object.keys(out) as (keyof Preview)[]) if (out[key] === undefined) delete out[key];
	return out;
}

/**
 * Read the open tab's preview. Runs with `activeTab` (granted by the click), sees the final
 * post-redirect page and the logged-in version of it, and uses the server's own parser.
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
		return null; // restricted pages (stores, PDFs, browser UI): the server fills the preview
	}
}

type Saved = { bookmark: Bookmark; alreadyExists: boolean };

const split = ({ alreadyExists, ...bookmark }: Bookmark & { alreadyExists: boolean }): Saved => ({ bookmark, alreadyExists });

/** Asks the background to fetch missing previews now (from the user's browser). */
const enrichSoon = (b: Bookmark) => {
	if (b.content.type === 'link' && b.content.crawlStatus !== 'success') void chrome.runtime.sendMessage({ type: 'enrich' }).catch(() => {});
};

/** Saves the tab with the preview read from it, or returns null (silently) for the user's own Zerostash pages. */
export async function saveTab(tab: chrome.tabs.Tab): Promise<Saved | null> {
	const settings = await getSettings();
	if (isOwnServer(tab.url, settings)) return null;
	const page = tab.id !== undefined ? await readTab(tab.id) : null;
	const url = page?.url ?? tab.url;
	if (!isHttpUrl(url)) throw new Error('Only web pages (http:// and https://) can be saved.');
	if (isOwnServer(url, settings)) return null;
	const og = page ? previewOf(page.og) : {};
	og.title ??= tab.title?.slice(0, 500) || undefined;
	const saved = split(await (await api()).bookmarks.createBookmark.mutate({ type: 'link', url, source: 'extension', og }));
	enrichSoon(saved.bookmark);
	return saved;
}

export async function saveLink(url: string): Promise<Saved | null> {
	if (!isHttpUrl(url)) throw new Error('Only http(s) links can be saved.');
	if (isOwnServer(url, await getSettings())) return null;
	const saved = split(await (await api()).bookmarks.createBookmark.mutate({ type: 'link', url, source: 'extension' }));
	enrichSoon(saved.bookmark);
	return saved;
}

export async function saveSelection(text: string, tab?: chrome.tabs.Tab): Promise<Saved> {
	return split(
		await (await api()).bookmarks.createBookmark.mutate({
			type: 'text',
			text: text.slice(0, 20_000),
			title: tab?.title?.slice(0, 500) || undefined,
			sourceUrl: isHttpUrl(tab?.url) ? tab.url : undefined,
			source: 'extension',
		}),
	);
}
