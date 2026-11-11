// OpenGraph/meta extraction from raw HTML. Shared by the extension's background
// worker (no DOMParser in MV3 service workers) and the server fallback, so it is a
// small string parser rather than a DOM walk. Only the <head> is ever examined.

export type OgSource = 'tab' | 'bookmarklet' | 'extension' | 'feed' | 'server';

// Higher rank wins; a lower-ranked source never overwrites a higher one.
export const OG_SOURCE_RANK: Record<OgSource, number> = {
	server: 1,
	feed: 2,
	extension: 3,
	bookmarklet: 4,
	tab: 5,
};

export interface OgData {
	url?: string; // canonical / og:url, if the page declares one
	title?: string;
	description?: string;
	imageUrl?: string;
	siteName?: string;
	faviconUrl?: string;
}

export const OG_MAX_HTML_BYTES = 256 * 1024;

/**
 * Hosts a background fetch must never touch: the user's machine and private networks.
 * Bookmark URLs can come from imports/feeds, and the extension fetches with the
 * user's network position, so this blocks reaching routers, local dev servers, etc.
 */
export function isPrivateHost(url: string): boolean {
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
	} catch {
		return true;
	}
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
	if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return host.includes(':');
	const ip = host.split('.').map(Number);
	if (ip.length !== 4 || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
	const [a, b] = ip;
	return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function isHttpUrl(value: string | undefined | null): value is string {
	if (!value) return false;
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“',
};

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
		if (code[0] === '#') {
			const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
		}
		return NAMED_ENTITIES[code.toLowerCase()] ?? match;
	});
}

function clean(text: string | undefined, max: number): string | undefined {
	if (!text) return undefined;
	const value = decodeEntities(text).replace(/\s+/g, ' ').trim();
	return value ? value.slice(0, max) : undefined;
}

function absolute(href: string | undefined, base: string): string | undefined {
	if (!href) return undefined;
	try {
		const url = new URL(decodeEntities(href.trim()), base).toString();
		return isHttpUrl(url) && url.length <= 2048 ? url : undefined;
	} catch {
		return undefined;
	}
}

function attributes(tag: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const re = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
	for (let m = re.exec(tag); m; m = re.exec(tag)) {
		attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
	}
	return attrs;
}

/** Everything up to </head> (or the first OG_MAX_HTML_BYTES chars when there is none). */
export function headOf(html: string): string {
	const end = html.search(/<\/head\s*>/i);
	return end === -1 ? html.slice(0, OG_MAX_HTML_BYTES) : html.slice(0, end);
}

/** Extract OpenGraph/Twitter/HTML meta from a page. `baseUrl` is the final (post-redirect) URL. */
export function parseOg(html: string, baseUrl: string): OgData {
	const head = headOf(html);
	const meta: Record<string, string> = {};
	for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
		const a = attributes(tag);
		const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
		if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
	}

	let faviconHref: string | undefined;
	let canonicalHref: string | undefined;
	for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
		const a = attributes(tag);
		const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
		if (rel.includes('canonical')) canonicalHref ??= a.href;
		if (rel.includes('icon') || rel.includes('apple-touch-icon')) faviconHref ??= a.href;
	}

	const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
	const base = isHttpUrl(baseUrl) ? baseUrl : 'https://invalid.invalid/';

	return {
		url: absolute(meta['og:url'] ?? canonicalHref, base),
		title: clean(meta['og:title'] ?? meta['twitter:title'] ?? titleTag, 500),
		description: clean(meta['og:description'] ?? meta['twitter:description'] ?? meta['description'], 2000),
		imageUrl: absolute(
			meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'] ?? meta['twitter:image:src'],
			base,
		),
		siteName: clean(meta['og:site_name'] ?? meta['application-name'], 200),
		faviconUrl: absolute(faviconHref ?? '/favicon.ico', base),
	};
}

/**
 * Read a fetch Response body only up to </head> (or OG_MAX_HTML_BYTES), then cancel
 * the rest, so neither the browser nor the Worker downloads whole pages.
 */
export async function readHead(res: Response): Promise<string> {
	if (!res.body) return '';
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let html = '';
	try {
		while (html.length < OG_MAX_HTML_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			html += decoder.decode(value, { stream: true });
			if (/<\/head\s*>/i.test(html)) break;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	return html;
}
