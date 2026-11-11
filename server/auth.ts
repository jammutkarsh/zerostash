// Single-owner auth: one deploy-time secret (ZEROSTASH_SECRET).
// - Extension/scripts send it as `Authorization: Bearer <secret>`.
// - The web UI exchanges it once for an HMAC-signed session cookie.
// No password KDF: the secret is high-entropy, and the Free plan allows 10 ms CPU.

const enc = new TextEncoder();
export const SESSION_COOKIE = 'zs_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MIN_SECRET_LENGTH = 32;

export function secretConfigured(secret: string | undefined): secret is string {
	return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

/** Constant-time comparison of a presented secret against the configured one. */
export async function secretMatches(given: string, secret: string): Promise<boolean> {
	const [a, b] = await Promise.all([
		crypto.subtle.digest('SHA-256', enc.encode(given)),
		crypto.subtle.digest('SHA-256', enc.encode(secret)),
	]);
	return crypto.subtle.timingSafeEqual(a, b);
}

function hmacKey(secret: string, usage: 'sign' | 'verify') {
	return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function toBase64Url(buf: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(buf)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
	try {
		const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
		return Uint8Array.from(bin, (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

/** Cookie value `<expiresAtSeconds>.<hmac>`; rotating the secret invalidates every session. */
export async function signSession(secret: string, now = Date.now()): Promise<string> {
	const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
	const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`session:${exp}`));
	return `${exp}.${toBase64Url(mac)}`;
}

export async function verifySession(value: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
	if (!value) return false;
	const [expText, macText] = value.split('.');
	const exp = Number(expText);
	const mac = macText ? fromBase64Url(macText) : null;
	if (!Number.isInteger(exp) || exp * 1000 < now || !mac) return false;
	return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), mac, enc.encode(`session:${exp}`));
}
