// RSS 2.0 / RSS 1.0 (RDF) / Atom parsing with string matching: Workers have no DOMParser, and
// feeds only need a handful of fields per item.
import { decodeEntities, isHttpUrl } from './og';

export interface FeedItem {
	url: string;
	title?: string;
	summary?: string;
	categories: string[];
	published?: number;
}

const unwrap = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
// Item text is often HTML escaped inside XML: decode the XML layer, drop tags, decode the HTML layer.
const plain = (s: string) =>
	decodeEntities(decodeEntities(unwrap(s)).replace(/<[^>]*>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();

function inner(block: string, tag: string): string | undefined {
	const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
	return m ? m[1] : undefined;
}

function attr(tag: string, name: string): string | undefined {
	const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
	return m ? decodeEntities(m[2] ?? m[3]) : undefined;
}

function absolute(href: string | undefined, base: string): string | undefined {
	if (!href) return undefined;
	try {
		const url = new URL(decodeEntities(unwrap(href).trim()), base).toString();
		return isHttpUrl(url) ? url : undefined;
	} catch {
		return undefined;
	}
}

function linkOf(block: string, base: string): string | undefined {
	// Atom: <link href="..."/> (rel="alternate" or no rel); RSS: <link>url</link>.
	for (const tag of block.match(/<link\b[^>]*>/gi) ?? []) {
		const rel = attr(tag, 'rel');
		const href = attr(tag, 'href');
		if (href && (!rel || rel === 'alternate')) return absolute(href, base);
	}
	const text = inner(block, 'feedburner:origLink') ?? inner(block, 'link');
	if (text?.trim()) return absolute(text, base);
	const guid = /<guid\b([^>]*)>([\s\S]*?)<\/guid>/i.exec(block);
	if (guid && attr(guid[1], 'isPermaLink') !== 'false') return absolute(guid[2], base);
	return undefined;
}

export function parseFeed(xml: string, baseUrl: string): FeedItem[] {
	const blocks = xml.match(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
	const items: FeedItem[] = [];
	for (const block of blocks) {
		const url = linkOf(block, baseUrl);
		if (!url) continue;
		const title = inner(block, 'title');
		const summary = inner(block, 'description') ?? inner(block, 'summary') ?? inner(block, 'content');
		const categories = [
			...[...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)].map((m) => plain(m[1])),
			...(block.match(/<category\b[^>]*\/>/gi) ?? []).map((t) => attr(t, 'term') ?? ''),
		].filter(Boolean);
		const date = inner(block, 'pubDate') ?? inner(block, 'published') ?? inner(block, 'updated') ?? inner(block, 'dc:date');
		const published = date ? Date.parse(plain(date)) : NaN;
		items.push({
			url,
			title: title ? plain(title).slice(0, 500) || undefined : undefined,
			summary: summary ? plain(summary).slice(0, 2000) || undefined : undefined,
			categories: [...new Set(categories.map((c) => c.slice(0, 64)))],
			published: Number.isFinite(published) ? published : undefined,
		});
	}
	return items;
}
