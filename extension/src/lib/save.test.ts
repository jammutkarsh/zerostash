import { expect, test } from 'bun:test';
import { Preview } from '../../../shared/schemas';
import { previewOf } from './save';

test('previewOf keeps only what the server accepts', () => {
	const og = {
		title: '  A title  ',
		description: 'x'.repeat(3000),
		imageUrl: 'data:image/png;base64,AAAA',
		faviconUrl: 'https://example.com/favicon.ico',
		siteName: '',
	};
	const p = previewOf(og);
	expect(p).toEqual({ title: 'A title', description: 'x'.repeat(2000), faviconUrl: 'https://example.com/favicon.ico' });
	expect(Preview.safeParse(p).success).toBe(true); // what the server validates against
});
