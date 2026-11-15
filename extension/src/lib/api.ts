// The extension talks to the user's server over the same tRPC API as the web app and Karakeep's
// clients (types straight from server/trpc.ts), with the server secret as a Bearer key. The
// server's CORS allows extension origins.
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../../server/trpc';
import { getSettings } from './settings';

type Connection = { serverUrl: string; secret: string };

/** Oldest server this extension works with (createBookmark's `og`, zerostash.previewsNeeded/setPreview). */
export const MIN_SERVER_VERSION = '1.1.0';

export async function api(override?: Connection) {
	const { serverUrl, secret } = override ?? (await getSettings());
	if (!serverUrl || !secret) throw new Error('Connect the extension to your server first.');
	return createTRPCClient<AppRouter>({
		links: [httpBatchLink({ url: `${serverUrl}/api/trpc`, transformer: superjson, headers: () => ({ authorization: `Bearer ${secret}` }) })],
	});
}

export interface Health {
	name?: string;
	version?: string;
	setupRequired?: boolean;
}

export async function health(serverUrl: string): Promise<Health> {
	const res = await fetch(`${serverUrl}/api/health`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

/** a < b, comparing x.y.z numerically (pre-release suffixes ignored). */
export function olderThan(a: string, b: string): boolean {
	const parse = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
	const [x, y] = [parse(a), parse(b)];
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
	return false;
}
