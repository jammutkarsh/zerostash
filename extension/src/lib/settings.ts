export interface Settings {
	serverUrl: string; // origin of the user's Zerostash Worker, e.g. https://zerostash.me.workers.dev
	secret: string; // ZEROSTASH_SECRET; kept in storage.local only (never synced)
	autoSave: boolean;
}

// autoSave is off by default: clicking the button may just be a way to open the app.
const DEFAULTS: Settings = { serverUrl: '', secret: '', autoSave: false };

export async function getSettings(): Promise<Settings> {
	return { ...DEFAULTS, ...(await chrome.storage.local.get<Partial<Settings>>(DEFAULTS)) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
	await chrome.storage.local.set(patch);
}

export function isConfigured(s: Settings): boolean {
	return !!s.serverUrl && !!s.secret;
}

/**
 * Reduce whatever was pasted (a dashboard link, a bare host name, an http:// address) to the
 * server's https origin: path, query and credentials dropped, http upgraded to https.
 * Plain http stays only for a local dev server.
 */
export function normaliseServerUrl(input: string): string {
	const raw = input.trim();
	const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
	const url = new URL(raw.includes('://') ? raw : `${localHost.test(raw) ? 'http' : 'https'}://${raw}`);
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an https:// address.');
	if (url.protocol === 'http:' && !localHost.test(url.host)) url.protocol = 'https:';
	return url.origin;
}

export const ALL_URLS = { origins: ['<all_urls>'] };

/** Pages of the user's own Zerostash server are never bookmarked. */
export function isOwnServer(url: string | undefined, s: Settings): boolean {
	if (!url || !s.serverUrl) return false;
	try {
		return new URL(url).origin === new URL(s.serverUrl).origin;
	} catch {
		return false;
	}
}
