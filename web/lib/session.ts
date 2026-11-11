// The session cookie is HttpOnly, so the page can't read it. This flag is only a hint
// for routing (`/` → marketing page or /dashboard) so the landing page stays static and
// never calls the Worker; /api/v1/me is still the real check.
const KEY = 'zs_signed_in';

export function hasSessionHint(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

export function setSessionHint(on: boolean) {
	try {
		if (on) localStorage.setItem(KEY, '1');
		else localStorage.removeItem(KEY);
	} catch {}
}
