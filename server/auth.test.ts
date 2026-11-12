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
	// Tamper with a middle character of the MAC: the last base64url char only carries 4 bits,
	// so swapping it can decode to the same bytes and make this check flaky.
	const [exp, mac] = cookie.split('.');
	const mid = Math.floor(mac.length / 2);
	const flipped = `${exp}.${mac.slice(0, mid)}${mac[mid] === 'A' ? 'B' : 'A'}${mac.slice(mid + 1)}`;
	expect(await verifySession(flipped, secret, now)).toBe(false); // tampered MAC
	expect(await verifySession(`${Number(exp) + 1}.${mac}`, secret, now)).toBe(false); // tampered expiry
	expect(await verifySession(undefined, secret, now)).toBe(false);
	expect(await verifySession('garbage', secret, now)).toBe(false);
});
