<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import { onMount } from 'svelte';
	import { API_VERSION, server } from './lib/api';
	import { ALL_URLS, getSettings, normaliseServerUrl, saveSettings } from './lib/settings';

	let serverUrl = $state('');
	let secret = $state('');
	let autoSave = $state(false);
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
		// Show where things stand without making people press "Save & test" to find out.
		if (serverUrl && secret) await check(false);
	});

	async function connect(e: SubmitEvent) {
		e.preventDefault();
		await check(true);
	}

	async function check(save: boolean) {
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
			if (save) {
				await saveSettings({ serverUrl: origin, secret: secret.trim() });
				serverUrl = origin;
				await chrome.runtime.sendMessage({ type: 'settings-changed' });
			}
			const drift =
				health.apiVersion > API_VERSION
					? ' Your server is newer than this extension — update the extension.'
					: health.apiVersion < API_VERSION
						? ' Your server is older than this extension — sync your fork to update it.'
						: '';
			status = { ok: !drift, text: `Connected to Zerostash ${health.version} at ${new URL(origin).host}.${drift}` };
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

	// Forget the server and secret. Two clicks, because the secret can't be read back from Cloudflare.
	let confirmReset = $state(false);
	async function reset() {
		if (!confirmReset) {
			confirmReset = true;
			setTimeout(() => (confirmReset = false), 4000);
			return;
		}
		await chrome.storage.local.clear();
		await chrome.runtime.sendMessage({ type: 'settings-changed' });
		[serverUrl, secret, autoSave, fetchResult, confirmReset] = ['', '', false, '', false];
		status = { ok: true, text: 'Reset. This browser no longer stores a server or secret.' };
	}

	async function fetchNow() {
		fetchResult = 'Fetching…';
		const res = (await chrome.runtime.sendMessage({ type: 'enrich' })) as { filled?: number; error?: string };
		fetchResult = res.error ? `Failed: ${res.error}` : `Filled ${res.filled} preview${res.filled === 1 ? '' : 's'}.`;
	}
</script>

<!-- Hover (or focus) tooltip, overlaid on the row below; positioned by the nearest `relative` row. -->
{#snippet tip(id: string, text: string)}
	<span class="group inline-flex">
		<button type="button" aria-label="More info" aria-describedby={id} class="cursor-help rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:text-foreground">
			<Info class="size-3.5" />
		</button>
		<span
			{id}
			role="tooltip"
			class="pointer-events-none invisible absolute inset-x-0 top-full z-10 mt-1 rounded-md bg-foreground p-2.5 text-xs leading-relaxed font-normal text-background opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
			>{text}</span
		>
	</span>
{/snippet}

<main class="mx-auto grid max-w-xl gap-8 p-8 text-sm">
	<header class="flex items-center gap-3">
		<img src="/icons/icon48.png" alt="" class="size-10" />
		<div>
			<h1 class="text-xl font-semibold">Zerostash</h1>
			<p class="text-muted-foreground">Connect this extension to your own Zerostash server.</p>
		</div>
	</header>

	<div class="grid gap-6 rounded-xl border bg-card p-5">
		<form onsubmit={connect} class="grid gap-4">
			<h2 class="text-base font-semibold">Server</h2>
			<label class="grid gap-1.5 font-medium">
				Server URL
				<input bind:value={serverUrl} required placeholder="https://zerostash.you.workers.dev" class="rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-accent" />
			</label>
			<div class="grid gap-1.5">
				<div class="relative flex items-center gap-1 font-medium">
					<label for="secret">Secret</label>{@render tip('secret-tip', 'The ZEROSTASH_SECRET you set on your Worker. Stored only in this browser.')}
				</div>
				<input id="secret" bind:value={secret} required type="password" autocomplete="off" class="rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-accent" />
			</div>
			<div class="flex gap-2">
				<button disabled={busy} class="flex-1 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-60">
					{busy ? 'Checking…' : 'Save & test connection'}
				</button>
				<button type="button" onclick={reset} class="rounded-md border px-3 py-2 font-medium hover:bg-muted {confirmReset ? 'border-destructive text-destructive' : ''}">
					{confirmReset ? 'Click again to reset' : 'Reset'}
				</button>
			</div>
			{#if status}<p class={status.ok ? 'text-green-700 dark:text-green-400' : 'text-destructive'}>{status.text}</p>{/if}
		</form>

		<section class="grid gap-3 border-t pt-6">
			<div class="relative flex items-center gap-1">
				<h2 class="text-base font-semibold">Link previews (recommended)</h2>
				{@render tip(
					'previews-tip',
					'Links you save from the web app, imports, RSS or the right-click menu get their title and image fetched by this browser — it follows redirects and opens pages that block servers. This needs access to all sites; it is only used to read page headers for your bookmarks. Without it, your server fetches previews instead (slower, and some sites block it).',
				)}
			</div>
			<p class="-mt-1 text-muted-foreground">Lets this browser fetch titles and images, so sites that block servers still get previews. Needs access to all sites; it only reads page headers.</p>
			{#if previewsAllowed}
				<p class="text-green-700 dark:text-green-400">Allowed ✓</p>
				<div class="flex items-center gap-3">
					<button onclick={fetchNow} class="rounded-md border px-3 py-1.5 hover:bg-muted">Fetch previews now</button>
					<span class="text-muted-foreground">{fetchResult}</span>
				</div>
			{:else}
				<button onclick={allowPreviews} class="justify-self-start rounded-md border px-3 py-1.5 hover:bg-muted">Allow link previews</button>
			{/if}
		</section>

		<section class="grid gap-3 border-t pt-6">
			<h2 class="text-base font-semibold">Toolbar button</h2>
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={autoSave} onchange={(e) => saveSettings({ autoSave: e.currentTarget.checked })} />
				Save the page as soon as I click the toolbar button
			</label>
		</section>
	</div>
</main>
