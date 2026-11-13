import { expect, test } from 'bun:test';
import { parseQuery } from './query';

test('free text and implicit AND', () => {
	expect(parseQuery('')).toEqual({ k: 'all' });
	expect(parseQuery('postgres')).toEqual({ k: 'text', v: 'postgres' });
	expect(parseQuery('hello world')).toEqual({ k: 'and', of: [{ k: 'text', v: 'hello' }, { k: 'text', v: 'world' }] });
	expect(parseQuery('"hello world"')).toEqual({ k: 'text', v: 'hello world' });
});

test('qualifiers', () => {
	expect(parseQuery('is:fav')).toEqual({ k: 'is', v: 'fav' });
	expect(parseQuery('is:Favourited')).toEqual({ k: 'is', v: 'fav' });
	expect(parseQuery('has:notes')).toEqual({ k: 'has', v: 'notes' });
	expect(parseQuery('#go')).toEqual({ k: 'tag', v: 'go' });
	expect(parseQuery('tag:"two words"')).toEqual({ k: 'tag', v: 'two words' });
	expect(parseQuery('list:"Go Deep Dive"')).toEqual({ k: 'list', v: 'Go Deep Dive' });
	expect(parseQuery('url:github.com')).toEqual({ k: 'url', v: 'github.com' });
	expect(parseQuery('after:2026-01-02')).toEqual({ k: 'after', v: Date.UTC(2026, 0, 2) });
	expect(parseQuery('before:2026-01-02')).toEqual({ k: 'before', v: Date.UTC(2026, 0, 3) });
	expect(parseQuery('age:<7d')).toEqual({ k: 'age', op: '<', ms: 7 * 86_400_000 });
});

test('unknown or malformed qualifiers are text', () => {
	expect(parseQuery('is:nonsense')).toEqual({ k: 'text', v: 'is:nonsense' });
	expect(parseQuery('after:yesterday')).toEqual({ k: 'text', v: 'after:yesterday' });
	expect(parseQuery('https://x.com/a')).toEqual({ k: 'text', v: 'https://x.com/a' });
	expect(parseQuery('"is:fav"')).toEqual({ k: 'text', v: 'is:fav' });
	expect(parseQuery('#')).toEqual({ k: 'text', v: '#' });
});

test('operators, negation, grouping', () => {
	expect(parseQuery('postgres or planetscale')).toEqual({ k: 'or', of: [{ k: 'text', v: 'postgres' }, { k: 'text', v: 'planetscale' }] });
	expect(parseQuery('-is:archived')).toEqual({ k: 'not', of: { k: 'is', v: 'archived' } });
	expect(parseQuery('a and b or c')).toEqual({
		k: 'or',
		of: [{ k: 'and', of: [{ k: 'text', v: 'a' }, { k: 'text', v: 'b' }] }, { k: 'text', v: 'c' }],
	});
	expect(parseQuery('is:fav -(#a or #b)')).toEqual({
		k: 'and',
		of: [{ k: 'is', v: 'fav' }, { k: 'not', of: { k: 'or', of: [{ k: 'tag', v: 'a' }, { k: 'tag', v: 'b' }] } }],
	});
	// Lenient: unbalanced parentheses and a bare minus don't throw.
	expect(parseQuery('(a or b')).toEqual({ k: 'or', of: [{ k: 'text', v: 'a' }, { k: 'text', v: 'b' }] });
	expect(parseQuery('a ) b')).toEqual({ k: 'and', of: [{ k: 'text', v: 'a' }, { k: 'text', v: 'b' }] });
	expect(parseQuery('- a')).toEqual({ k: 'and', of: [{ k: 'text', v: '-' }, { k: 'text', v: 'a' }] });
});
