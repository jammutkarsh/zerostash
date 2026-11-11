<script lang="ts">
	import { onMount } from 'svelte';
	import { API_VERSION, server } from './lib/api';
	import { ALL_URLS, getSettings, normaliseServerUrl, saveSettings } from './lib/settings';

	let serverUrl = $state('');
	let secret = $state('');
	let autoSave = $state(true);
	let previewsAllowed = $state(false);
	let status = $state<{ ok: boolean; text: string } | null>(null);
	let busy = $state(false);
	let fetchResult = $state('');

	onMount(async () => {
		const s = await getSettings();
		serverUrl = s.serverUrl;
		secret = s.secret;
		autoSave = s.autoSave;
		previewsAllowed = await chrome.permissions.contains(ALL_URLS);
	});

	async function connect(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		status = null;
		try {
			const origin = normaliseServerUrl(serverUrl);
			const health = await server.health(origin).catch(() => {
				throw new Error(`No Zerostash server answered at ${origin}.`);
			});
			if (health.name !== 'zerostash') throw new Error(`${origin} isn't a Zerostash server.`);
			if (health.setupRequired) throw new Error('The server has no ZEROSTASH_SECRET yet. Set it in Cloudflare first.');
			await server.me({ serverUrl: origin, secret: secret.trim() }).catch(() => {
				throw new Error("The server rejected that secret. Use the value of ZEROSTASH_SECRET.");
			});
			await saveSettings({ serverUrl: origin, secret: secret.trim(), autoSave });
			serverUrl = origin;
			await chrome.runtime.sendMessage({ type: 'settings-changed' });
			const drift =
				health.apiVersion > API_VERSION
					? ' Your server is newer than this extension — update the extension.'
					: health.apiVersion < API_VERSION
						? ' Your server is older than this extension — sync your fork to update it.'
						: '';
			status = { ok: !drift, text: `Connected to Zerostash ${health.version}.${drift}` };
		} catch (err) {
			status = { ok: false, text: err instanceof Error ? err.message : String(err) };
		} finally {
			busy = false;
		}
	}

	// Must run from a click: browsers only grant permissions on a user gesture.
	async function allowPreviews() {
		previewsAllowed = await chrome.permissions.request(ALL_URLS);
		if (previewsAllowed) await chrome.runtime.sendMessage({ type: 'settings-changed' });
	}

	async function fetchNow() {
		fetchResult = 'Fetching…';
		const res = (await chrome.runtime.sendMessage({ type: 'enrich' })) as { filled?: number; error?: string };
		fetchResult = res.error ? `Failed: ${res.error}` : `Filled ${res.filled} preview${res.filled === 1 ? '' : 's'}.`;
	}
</script>

<main class="mx-auto grid max-w-xl gap-8 p-8 text-sm">
	<header class="flex items-center gap-3">
		<img src="/icons/icon48.png" alt="" class="size-10" />
		<div>
			<h1 class="text-xl font-semibold">Zerostash</h1>
			<p class="text-muted-foreground">Connect this extension to your own Zerostash server.</p>
		</div>
	</header>

	<form onsubmit={connect} class="grid gap-4 rounded-xl border bg-card p-5">
		<h2 class="font-semibold">1. Server</h2>
		<label class="grid gap-1.5 font-medium">
			Server URL
			<input bind:value={serverUrl} required placeholder="https://zerostash.you.workers.dev" class="rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-accent" />
		</label>
		<label class="grid gap-1.5 font-medium">
			Secret
			<input bind:value={secret} required type="password" autocomplete="off" class="rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-accent" />
			<span class="text-xs font-normal text-muted-foreground">The ZEROSTASH_SECRET you set on your Worker. Stored only in this browser.</span>
		</label>
		<label class="flex items-center gap-2">
			<input type="checkbox" bind:checked={autoSave} />
			Save immediately when I click the toolbar button
		</label>
		<button disabled={busy} class="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-60">
			{busy ? 'Checking…' : 'Save & test connection'}
		</button>
		{#if status}<p class={status.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'}>{status.text}</p>{/if}
	</form>

	<section class="grid gap-3 rounded-xl border bg-card p-5">
		<h2 class="font-semibold">2. Link previews (recommended)</h2>
		<p class="text-muted-foreground">
			Links you save from the web app, imports, RSS or the right-click menu get their title and image fetched by this browser —
			it follows redirects and opens pages that block servers. This needs access to all sites; it is only used to read page
			headers for your bookmarks. Without it, your server fetches previews instead (slower, and some sites block it).
		</p>
		{#if previewsAllowed}
			<p class="text-green-600 dark:text-green-400">Allowed ✓</p>
			<div class="flex items-center gap-3">
				<button onclick={fetchNow} class="rounded-md border px-3 py-1.5 hover:bg-muted">Fetch previews now</button>
				<span class="text-muted-foreground">{fetchResult}</span>
			</div>
		{:else}
			<button onclick={allowPreviews} class="justify-self-start rounded-md border px-3 py-1.5 hover:bg-muted">Allow link previews</button>
		{/if}
	</section>
</main>
