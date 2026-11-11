import { expect, test } from 'bun:test';
import { relativeTime } from './time';

test('relativeTime', () => {
	const now = Date.UTC(2026, 10, 11, 12);
	expect(relativeTime(now - 10_000, now)).toBe('just now');
	expect(relativeTime(now - 5 * 60_000, now)).toContain('5 minutes');
	expect(relativeTime(now - 3 * 3600_000, now)).toContain('3 hours');
	expect(relativeTime(now - 24 * 3600_000, now)).toBe('yesterday');
	expect(relativeTime(now - 14 * 24 * 3600_000, now)).toContain('2 weeks');
	expect(relativeTime(now - 90 * 24 * 3600_000, now)).toMatch(/2026/);
});
