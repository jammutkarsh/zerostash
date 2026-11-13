import { expect, test } from 'bun:test';
import { parseFeed } from './feed';

test('RSS 2.0: links, CDATA, entities, categories, dates', () => {
	const xml = `<?xml version="1.0"?><rss><channel><title>Blog</title>
		<item><title><![CDATA[Hello & <b>world</b>]]></title><link>https://ex.com/a</link>
			<description>&lt;p&gt;Body &amp;amp; more&lt;/p&gt;</description>
			<category>Go</category><category><![CDATA[Databases]]></category><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate></item>
		<item><title>Relative</title><link>/b</link></item>
		<item><title>Guid only</title><guid isPermaLink="true">https://ex.com/c</guid></item>
		<item><title>Not a link</title><guid isPermaLink="false">tag:x</guid></item>
	</channel></rss>`;
	const items = parseFeed(xml, 'https://ex.com/feed.xml');
	expect(items.map((i) => i.url)).toEqual(['https://ex.com/a', 'https://ex.com/b', 'https://ex.com/c']);
	expect(items[0]).toEqual({
		url: 'https://ex.com/a',
		title: 'Hello & world',
		summary: 'Body & more',
		categories: ['Go', 'Databases'],
		published: Date.UTC(2026, 10, 10, 10),
	});
});

test('Atom: alternate links, category terms, summary/content', () => {
	const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
		<entry><title type="html">Post &amp; one</title>
			<link rel="self" href="https://ex.com/self"/><link rel="alternate" href="https://ex.com/post-1"/>
			<category term="rust"/><summary>Short</summary><updated>2026-11-01T00:00:00Z</updated></entry>
		<entry><title>Two</title><link href="post-2"/><content type="html">&lt;p&gt;Hi&lt;/p&gt;</content></entry>
	</feed>`;
	const items = parseFeed(xml, 'https://ex.com/atom.xml');
	expect(items).toEqual([
		{ url: 'https://ex.com/post-1', title: 'Post & one', summary: 'Short', categories: ['rust'], published: Date.UTC(2026, 10, 1) },
		{ url: 'https://ex.com/post-2', title: 'Two', summary: 'Hi', categories: [], published: undefined },
	]);
});

test('rejects non-http links and survives junk', () => {
	expect(parseFeed('<rss><item><link>javascript:alert(1)</link></item></rss>', 'https://ex.com/')).toEqual([]);
	expect(parseFeed('not xml at all', 'https://ex.com/')).toEqual([]);
});
