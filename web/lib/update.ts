// "Update available": compare this server's version with the latest upstream GitHub release.
// Checked from the browser (no Worker cost), at most every 6 hours, cached in localStorage.
export const UPSTREAM = 'jammutkarsh/zerostash';
const KEY = 'zs_latest_release';
const TTL = 6 * 60 * 60 * 1000;

export interface Release {
	version: string;
	url: string;
}

/** True when `a` is a newer semver than `b` (pre-release suffixes ignored). */
export function isNewer(a: string, b: string): boolean {
	const parse = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
	const [x, y] = [parse(a), parse(b)];
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
	return false;
}

export async function latestRelease(): Promise<Release | null> {
	try {
		const cached = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { at: number; release: Release | null } | null;
		if (cached && Date.now() - cached.at < TTL) return cached.release;
	} catch {}
	try {
		const res = await fetch(`https://api.github.com/repos/${UPSTREAM}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
		const body = res.ok ? ((await res.json()) as { tag_name?: string; html_url?: string }) : null;
		const release = body?.tag_name && body.html_url ? { version: body.tag_name.replace(/^v/, ''), url: body.html_url } : null;
		try {
			localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), release }));
		} catch {}
		return release;
	} catch {
		return null;
	}
}
