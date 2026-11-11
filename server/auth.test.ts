import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { secretConfigured, signSession, verifySession } from './auth';

test('the example secret can never pass the guard', () => {
	const example = /^ZEROSTASH_SECRET=(.*)$/m.exec(readFileSync(`${import.meta.dir}/../.dev.vars.example`, 'utf8'))?.[1] ?? '';
	expect(secretConfigured(example.trim())).toBe(false);
});

test('secretConfigured requires 32+ characters', () => {
	expect(secretConfigured(undefined)).toBe(false);
	expect(secretConfigured('x'.repeat(31))).toBe(false);
	expect(secretConfigured('x'.repeat(32))).toBe(true);
});

test('session cookie round-trips, expires, and dies with the secret', async () => {
	const secret = 'a'.repeat(40);
	const now = Date.now();
	const cookie = await signSession(secret, now);
	expect(await verifySession(cookie, secret, now)).toBe(true);
	expect(await verifySession(cookie, 'b'.repeat(40), now)).toBe(false); // rotated secret
	expect(await verifySession(cookie, secret, now + 31 * 24 * 3600 * 1000)).toBe(false); // expired
	expect(await verifySession(cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), secret, now)).toBe(false); // tampered
	expect(await verifySession(undefined, secret, now)).toBe(false);
	expect(await verifySession('garbage', secret, now)).toBe(false);
});
