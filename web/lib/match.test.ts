import { expect, test } from 'bun:test';
import type { Bookmark } from '../../shared/schemas';
import { byNewest, matches, select } from './match';

const bm = (id: string, o: Partial<Bookmark> = {}): Bookmark => ({
	id, type: 'link', url: `https://example.com/${id}`, title: null, description: null, imageUrl: null, siteName: null,
	faviconUrl: null, text: null, note: null, summary: null, favourited: false, archived: false, source: 'web',
	aiStatus: 'none', ogStatus: 'done', ogSource: null, listIds: [], createdAt: 0, updatedAt: 0, ...o,
}) as Bookmark;

test('matches: any field, any term, ignoring case', () => {
	const b = bm('a', { title: 'Shard your Postgres', note: 'read later' });
	expect(matches(b, ['postgres'])).toBe(true);
	expect(matches(b, ['LATER'])).toBe(true);
	expect(matches(b, ['example.com/a'])).toBe(true);
	expect(matches(b, ['mysql', 'shard'])).toBe(true);
	expect(matches(b, ['mysql'])).toBe(false);
	expect(matches(b, ['  '])).toBe(false);
	expect(matches(b, ['postgres\nread'])).toBe(false); // fields never run together
});

test('select: views, lists, smart lists and search', () => {
	const all = [
		bm('home', { createdAt: 4 }),
		bm('fav', { favourited: true, createdAt: 3 }),
		bm('arch', { archived: true, title: 'Postgres tips', createdAt: 2 }),
		bm('member', { archived: true, listIds: ['L'], createdAt: 1 }),
	].sort(byNewest);
	const ids = (bs: Bookmark[]) => bs.map((b) => b.id);
	expect(ids(select(all, { view: 'home' }))).toEqual(['home', 'fav']);
	expect(ids(select(all, { view: 'favourites' }))).toEqual(['fav']);
	expect(ids(select(all, { view: 'archive' }))).toEqual(['arch', 'member']);
	expect(ids(select(all, { view: 'home', q: 'postgres' }))).toEqual(['arch']); // search includes archived
	expect(ids(select(all, { view: 'home', list: { id: 'L', kind: 'manual', terms: [] } }))).toEqual(['member']);
	expect(ids(select(all, { view: 'home', list: { id: 'L', kind: 'smart', terms: ['tips'] } }))).toEqual(['arch', 'member']);
});

test('byNewest: created_at desc, then id desc', () => {
	expect([bm('a', { createdAt: 1 }), bm('c', { createdAt: 1 }), bm('b', { createdAt: 2 })].sort(byNewest).map((b) => b.id)).toEqual(['b', 'c', 'a']);
});
