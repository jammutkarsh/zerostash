import { describe, expect, test } from 'bun:test';
import { decodeEntities, headOf, isHttpUrl, isPrivateHost, parseOg, readHead } from './og';

describe('parseOg', () => {
	test('reads og:* tags, resolves relative URLs against the final URL', () => {
		const html = `<html><head>
			<title>Fallback title</title>
			<meta property="og:title" content="Real &amp; Title">
			<meta property='og:description' content='A "quoted" description'>
			<meta property="og:image" content="/img/cover.png">
			<meta property="og:site_name" content="Example">
			<link rel="canonical" href="https://example.com/post">
			<link rel="shortcut icon" href="/fav.ico">
		</head><body><meta property="og:title" content="ignored body tag"></body></html>`;
		expect(parseOg(html, 'https://example.com/a/b')).toEqual({
			url: 'https://example.com/post',
			title: 'Real & Title',
			description: 'A "quoted" description',
			imageUrl: 'https://example.com/img/cover.png',
			siteName: 'Example',
			faviconUrl: 'https://example.com/fav.ico',
		});
	});

	test('falls back to twitter:* and <title>, default favicon', () => {
		const html = `<head><title>  Plain
		Title </title><meta name="twitter:image" content="https://cdn.example.com/x.jpg"><meta name="description" content="desc"></head>`;
		const og = parseOg(html, 'https://example.com/');
		expect(og.title).toBe('Plain Title');
		expect(og.description).toBe('desc');
		expect(og.imageUrl).toBe('https://cdn.example.com/x.jpg');
		expect(og.faviconUrl).toBe('https://example.com/favicon.ico');
	});

	test('drops non-http URLs (stored XSS guard)', () => {
		const html = `<head><meta property="og:image" content="javascript:alert(1)"><link rel="icon" href="data:image/png;base64,AAA"></head>`;
		const og = parseOg(html, 'https://example.com/');
		expect(og.imageUrl).toBeUndefined();
		expect(og.faviconUrl).toBeUndefined();
	});

	test('handles unquoted attributes and content before property', () => {
		const og = parseOg('<head><meta content=Hello property=og:title></head>', 'https://e.com/');
		expect(og.title).toBe('Hello');
	});

	test('truncates long titles', () => {
		const og = parseOg(`<head><title>${'x'.repeat(900)}</title></head>`, 'https://e.com/');
		expect(og.title?.length).toBe(500);
	});
});

test('decodeEntities handles numeric and named entities', () => {
	expect(decodeEntities('&#39;a&#x27; &lt;b&gt; &unknown;')).toBe("'a' <b> &unknown;");
});

test('headOf stops at </head>', () => {
	expect(headOf('<head>a</head><body>b</body>')).toBe('<head>a');
});

test('isHttpUrl', () => {
	expect(isHttpUrl('https://x.y')).toBe(true);
	expect(isHttpUrl('javascript:alert(1)')).toBe(false);
	expect(isHttpUrl('not a url')).toBe(false);
});

test('readHead stops reading after </head>', async () => {
	let pulled = 0;
	const chunks = ['<html><head><title>T</title>', '</head><body>', 'x'.repeat(10), 'never'];
	const stream = new ReadableStream({
		pull(controller) {
			if (pulled < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[pulled++]));
			else controller.close();
		},
	});
	const html = await readHead(new Response(stream));
	expect(html).toContain('</head>');
	expect(html).not.toContain('never');
});

test('isPrivateHost blocks local and private networks only', () => {
	for (const u of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.1.1/', 'http://172.20.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://printer.local/', 'http://[fd00::1]/']) {
		expect(isPrivateHost(u)).toBe(true);
	}
	for (const u of ['https://example.com/', 'https://8.8.8.8/', 'https://172.32.0.1/', 'https://fdroid.org/', 'https://fc.example/']) {
		expect(isPrivateHost(u)).toBe(false);
	}
});
