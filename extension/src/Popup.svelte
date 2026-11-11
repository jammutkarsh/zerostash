<script lang="ts">
	import { onMount } from 'svelte';
	import type { Bookmark } from '../../shared/schemas';
	import { server } from './lib/api';
	import { saveTab } from './lib/save';
	import { getSettings, isConfigured, type Settings } from './lib/settings';

	type State =
		| { kind: 'loading' }
		| { kind: 'setup' }
		| { kind: 'confirm'; tab: chrome.tabs.Tab }
		| { kind: 'saving' }
		| { kind: 'saved'; bookmark: Bookmark; alreadyExists: boolean }
		| { kind: 'deleted' }
		| { kind: 'error'; message: string };

	let ui = $state<State>({ kind: 'loading' });
	let settings = $state<Settings | null>(null);
	let note = $state('');
	let noteSaved = $state(false);

	onMount(async () => {
		settings = await getSettings();
		if (!isConfigured(settings)) return (ui = { kind: 'setup' });
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab) return (ui = { kind: 'error', message: "This tab doesn't have a page to save." });
		if (settings.autoSave) await save(tab);
		else ui = { kind: 'confirm', tab };
	});

	async function save(tab: chrome.tabs.Tab) {
		ui = { kind: 'saving' };
		try {
			const { bookmark, alreadyExists } = await saveTab(tab);
			note = bookmark.note ?? '';
			ui = { kind: 'saved', bookmark, alreadyExists };
		} catch (e) {
			ui = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
		}
	}

	async function saveNote(bookmark: Bookmark) {
		await server.patch(bookmark.id, { note });
		noteSaved = true;
		setTimeout(() => (noteSaved = false), 1500);
	}

	async function remove(bookmark: Bookmark) {
		await server.remove(bookmark.id);
		ui = { kind: 'deleted' };
	}

	const domain = (url: string | null) => (url ? new URL(url).hostname.replace(/^www\./, '') : '');
</script>

<main class="w-80 p-4 text-sm">
	<header class="mb-3 flex items-center gap-2">
		<img src="/icons/icon32.png" alt="" class="size-5" />
		<span class="font-semibold">Zerostash</span>
		{#if settings?.serverUrl}
			<a href={settings.serverUrl} target="_blank" class="ml-auto text-xs text-muted-foreground hover:underline">Open app ↗</a>
		{/if}
	</header>

	{#if ui.kind === 'loading' || ui.kind === 'saving'}
		<p class="py-6 text-center text-muted-foreground">{ui.kind === 'saving' ? 'Saving…' : 'Loading…'}</p>
	{:else if ui.kind === 'setup'}
		<p class="mb-3">Connect the extension to your Zerostash server to start saving.</p>
		<button onclick={() => chrome.runtime.openOptionsPage()} class="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">
			Connect
		</button>
	{:else if ui.kind === 'confirm'}
		{@const tab = ui.tab}
		<p class="mb-1 line-clamp-2 font-medium">{tab.title}</p>
		<p class="mb-3 truncate text-xs text-muted-foreground">{tab.url}</p>
		<button onclick={() => save(tab)} class="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">Save bookmark</button>
	{:else if ui.kind === 'saved'}
		{@const b = ui.bookmark}
		<div class="mb-3 overflow-hidden rounded-lg border bg-card">
			{#if b.imageUrl}<img src={b.imageUrl} alt="" referrerpolicy="no-referrer" class="max-h-32 w-full object-cover" />{/if}
			<div class="p-2">
				<p class="line-clamp-2 font-medium">{b.title || b.url}</p>
				<p class="truncate text-xs text-muted-foreground">{domain(b.url)}</p>
			</div>
		</div>
		<p class="mb-2 text-xs font-medium {ui.alreadyExists ? 'text-muted-foreground' : 'text-green-600 dark:text-green-400'}">
			{ui.alreadyExists ? 'Already in your stash' : 'Saved ✓'}
		</p>
		<label class="mb-2 grid gap-1 text-xs font-medium">
			Note
			<textarea bind:value={note} rows="2" placeholder="Why are you saving this?" class="resize-none rounded-md border bg-card p-2 text-sm font-normal outline-none focus:ring-2 focus:ring-accent"></textarea>
		</label>
		<div class="flex gap-2">
			<button onclick={() => saveNote(b)} class="flex-1 rounded-md border px-3 py-1.5 hover:bg-muted">{noteSaved ? 'Note saved ✓' : 'Save note'}</button>
			<button onclick={() => remove(b)} class="rounded-md border px-3 py-1.5 text-destructive hover:bg-muted">Delete</button>
		</div>
	{:else if ui.kind === 'deleted'}
		<p class="py-6 text-center text-muted-foreground">Removed from your stash.</p>
	{:else}
		<p class="mb-3 text-destructive">{ui.message}</p>
		<button onclick={() => chrome.runtime.openOptionsPage()} class="text-xs text-muted-foreground hover:underline">Extension settings</button>
	{/if}
</main>
