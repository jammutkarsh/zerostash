export interface Settings {
	serverUrl: string; // origin of the user's Zerostash Worker, e.g. https://zerostash.me.workers.dev
	secret: string; // ZEROSTASH_SECRET; kept in storage.local only (never synced)
	autoSave: boolean;
}

const DEFAULTS: Settings = { serverUrl: '', secret: '', autoSave: true };

export async function getSettings(): Promise<Settings> {
	return { ...DEFAULTS, ...(await chrome.storage.local.get<Partial<Settings>>(DEFAULTS)) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
	await chrome.storage.local.set(patch);
}

export function isConfigured(s: Settings): boolean {
	return !!s.serverUrl && !!s.secret;
}

/** Normalise user input to an origin; only http(s), and plain http only for localhost. */
export function normaliseServerUrl(input: string): string {
	const url = new URL(input.trim().includes('://') ? input.trim() : `https://${input.trim()}`);
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Use an https:// address (http is allowed only for localhost).');
	return url.origin;
}

export const ALL_URLS = { origins: ['<all_urls>'] };
