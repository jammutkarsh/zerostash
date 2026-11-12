import { expect, test } from 'bun:test';
import { relativeTime, shortAge } from './time';

test('relativeTime', () => {
	const now = Date.UTC(2026, 10, 11, 12);
	expect(relativeTime(now - 10_000, now)).toBe('just now');
	expect(relativeTime(now - 5 * 60_000, now)).toContain('5 minutes');
	expect(relativeTime(now - 3 * 3600_000, now)).toContain('3 hours');
	expect(relativeTime(now - 24 * 3600_000, now)).toBe('yesterday');
	expect(relativeTime(now - 14 * 24 * 3600_000, now)).toContain('2 weeks');
	expect(relativeTime(now - 90 * 24 * 3600_000, now)).toMatch(/2026/);
});

test('shortAge', () => {
	const now = Date.UTC(2026, 10, 11, 12);
	expect(shortAge(now - 10_000, now)).toBe('now');
	expect(shortAge(now - 5 * 60_000, now)).toBe('5m');
	expect(shortAge(now - 3 * 3600_000, now)).toBe('3h');
	expect(shortAge(now - 2 * 86400_000, now)).toBe('2d');
	expect(shortAge(now - 15 * 86400_000, now)).toBe('2w');
	expect(shortAge(Date.UTC(2025, 0, 5), now)).toMatch(/2025/);
});
