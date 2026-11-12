<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Settings from '@lucide/svelte/icons/settings';
	import { onMount } from 'svelte';
	import { isHttpUrl } from '../../shared/og';
	import type { Bookmark } from '../../shared/schemas';
	import { server } from './lib/api';
	import { saveTab } from './lib/save';
	import { getSettings, isConfigured, isOwnServer, type Settings as Config } from './lib/settings';

	type State =
		| { kind: 'loading' }
		| { kind: 'setup' }
		| { kind: 'ready'; tab: chrome.tabs.Tab; savable: boolean }
		| { kind: 'saving' }
		| { kind: 'saved'; bookmark: Bookmark }
		| { kind: 'error'; message: string };

	let ui = $state<State>({ kind: 'loading' });
	let settings = $state<Config | null>(null);
	let note = $state('');
	let noteSaved = $state(false);
	let noteTimer: ReturnType<typeof setTimeout>;

	onMount(async () => {
		settings = await getSettings();
		if (!isConfigured(settings)) return (ui = { kind: 'setup' });
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		// The app itself and browser pages can't be stashed; the popup then just offers "Open Zerostash".
		const savable = !!tab && isHttpUrl(tab.url) && !isOwnServer(tab.url, settings);
		if (savable && settings.autoSave) await save(tab);
		else ui = { kind: 'ready', tab, savable };
	});

	async function save(tab: chrome.tabs.Tab) {
		ui = { kind: 'saving' };
		try {
			const result = await saveTab(tab);
			if (!result) return void (ui = { kind: 'ready', tab, savable: false });
			note = result.bookmark.note ?? '';
			ui = { kind: 'saved', bookmark: result.bookmark };
		} catch (e) {
			ui = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
		}
	}

	// Notes save themselves a moment after you stop typing (the popup can close any time).
	function onNoteInput(bookmark: Bookmark) {
		noteSaved = false;
		clearTimeout(noteTimer);
		noteTimer = setTimeout(async () => {
			await server.patch(bookmark.id, { note });
			noteSaved = true;
		}, 400);
	}

	function openApp() {
		if (settings?.serverUrl) void chrome.tabs.create({ url: `${settings.serverUrl}/dashboard` });
		window.close();
	}
</script>

<main class="w-[340px] text-sm">
	<header class="flex items-center gap-2 border-b bg-sidebar px-4 py-3">
		<img src="/icons/icon32.png" alt="" class="size-5" />
		<span class="font-bold tracking-tight">zerostash</span>
		<button onclick={() => chrome.runtime.openOptionsPage()} title="Settings" class="ml-auto rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
			<Settings class="size-4" />
		</button>
	</header>

	<div class="p-4">
		{#if ui.kind === 'loading' || ui.kind === 'saving'}
			<p class="flex items-center justify-center gap-2 py-6 text-muted-foreground">
				<LoaderCircle class="size-4 animate-spin" />{ui.kind === 'saving' ? 'Stashing…' : ''}
			</p>
		{:else if ui.kind === 'setup'}
			<p class="mb-1 font-semibold">Connect your server</p>
			<p class="mb-4 text-muted-foreground">Enter your Zerostash URL and secret once.</p>
			<button onclick={() => chrome.runtime.openOptionsPage()} class="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">Connect</button>
		{:else if ui.kind === 'ready'}
			{#if ui.savable}
				{@const tab = ui.tab}
				<p class="mb-3 line-clamp-2 font-medium">{tab.title || tab.url}</p>
				<button onclick={() => save(tab)} class="mb-2 w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">Stash this page</button>
			{/if}
			<button onclick={openApp} class="flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 font-medium hover:bg-muted">
				<ExternalLink class="size-4" />Open Zerostash
			</button>
		{:else if ui.kind === 'saved'}
			{@const b = ui.bookmark}
			<p class="mb-1 flex items-center gap-2 text-base font-semibold text-green-600 dark:text-green-400"><CircleCheck class="size-5" />Stashed</p>
			<p class="mb-3 line-clamp-2 text-muted-foreground">{b.title || b.url}</p>
			<textarea
				bind:value={note}
				oninput={() => onNoteInput(b)}
				rows="3"
				aria-label="Note"
				placeholder="Add a note"
				class="w-full resize-none rounded-md border bg-card p-2 outline-none focus:ring-2 focus:ring-accent/60"
			></textarea>
			{#if noteSaved}<p class="mt-1 text-right text-xs text-muted-foreground">Note saved</p>{/if}
		{:else}
			<p class="mb-3 text-destructive">{ui.message}</p>
			<button onclick={openApp} class="w-full rounded-md border px-3 py-2 font-medium hover:bg-muted">Open Zerostash</button>
		{/if}
	</div>
</main>
