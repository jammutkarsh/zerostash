<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Settings from '@lucide/svelte/icons/settings';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { onMount } from 'svelte';
	import type { Bookmark } from '../../shared/schemas';
	import { server } from './lib/api';
	import { saveTab } from './lib/save';
	import { getSettings, isConfigured, type Settings as Config } from './lib/settings';

	type State =
		| { kind: 'loading' }
		| { kind: 'setup' }
		| { kind: 'confirm'; tab: chrome.tabs.Tab }
		| { kind: 'saving' }
		| { kind: 'saved'; bookmark: Bookmark; alreadyExists: boolean }
		| { kind: 'deleted' }
		| { kind: 'error'; message: string };

	let ui = $state<State>({ kind: 'loading' });
	let settings = $state<Config | null>(null);
	let note = $state('');
	let noteState = $state<'idle' | 'saving' | 'saved'>('idle');
	let confirmDelete = $state(false);
	const isMac = navigator.platform.toLowerCase().includes('mac');

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
		noteState = 'saving';
		await server.patch(bookmark.id, { note });
		noteState = 'saved';
		setTimeout(() => (noteState = 'idle'), 1500);
	}

	async function remove(bookmark: Bookmark) {
		if (!confirmDelete) return void (confirmDelete = true);
		await server.remove(bookmark.id);
		ui = { kind: 'deleted' };
	}

	const domain = (url: string | null) => (url ? new URL(url).hostname.replace(/^www\./, '') : '');
</script>

<main class="w-[360px] text-sm">
	<header class="flex items-center gap-2 border-b bg-sidebar px-4 py-3">
		<img src="/icons/icon32.png" alt="" class="size-5 rounded" />
		<span class="font-bold tracking-tight">zerostash</span>
		<div class="ml-auto flex items-center gap-1">
			{#if settings?.serverUrl}
				<a href={`${settings.serverUrl}/dashboard`} target="_blank" title="Open Zerostash" class="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
					<ExternalLink class="size-4" />
				</a>
			{/if}
			<button onclick={() => chrome.runtime.openOptionsPage()} title="Settings" class="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
				<Settings class="size-4" />
			</button>
		</div>
	</header>

	<div class="p-4">
		{#if ui.kind === 'loading' || ui.kind === 'saving'}
			<p class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
				<LoaderCircle class="size-4 animate-spin" />{ui.kind === 'saving' ? 'Saving to your stash…' : 'Loading…'}
			</p>
		{:else if ui.kind === 'setup'}
			<p class="mb-1 font-semibold">Connect your server</p>
			<p class="mb-4 text-muted-foreground">Enter your Zerostash URL and secret once, then every click saves the page you're on.</p>
			<button onclick={() => chrome.runtime.openOptionsPage()} class="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">Connect</button>
		{:else if ui.kind === 'confirm'}
			{@const tab = ui.tab}
			<p class="mb-1 line-clamp-2 font-medium">{tab.title}</p>
			<p class="mb-4 truncate text-xs text-muted-foreground">{tab.url}</p>
			<button onclick={() => save(tab)} class="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">Save bookmark</button>
		{:else if ui.kind === 'saved'}
			{@const b = ui.bookmark}
			<p class="mb-3 flex items-center gap-2 font-medium {ui.alreadyExists ? 'text-muted-foreground' : 'text-green-600 dark:text-green-400'}">
				<CircleCheck class="size-4" />{ui.alreadyExists ? 'Already in your stash' : 'Saved to your stash'}
			</p>
			<div class="mb-3 overflow-hidden rounded-lg border bg-card shadow-sm">
				{#if b.imageUrl}<img src={b.imageUrl} alt="" referrerpolicy="no-referrer" class="max-h-36 w-full object-cover" />{/if}
				<div class="grid grid-cols-1 gap-1 p-3">
					<p class="line-clamp-2 leading-snug font-medium">{b.title || b.url}</p>
					<p class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
						{#if b.faviconUrl}<img src={b.faviconUrl} alt="" referrerpolicy="no-referrer" class="size-3.5 rounded-sm" />{/if}
						<span class="truncate">{domain(b.url)}</span>
					</p>
				</div>
			</div>
			<textarea
				bind:value={note}
				rows="2"
				aria-label="Note"
				placeholder="Add a note: why are you saving this?"
				class="mb-2 w-full resize-none rounded-md border bg-card p-2 outline-none focus:ring-2 focus:ring-accent/60"
			></textarea>
			<div class="flex gap-2">
				<button onclick={() => saveNote(b)} disabled={noteState === 'saving'} class="flex-1 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-60">
					{noteState === 'saved' ? 'Note saved ✓' : noteState === 'saving' ? 'Saving…' : 'Save note'}
				</button>
				<button onclick={() => remove(b)} onmouseleave={() => (confirmDelete = false)} class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-destructive hover:bg-muted">
					<Trash2 class="size-4" />{confirmDelete ? 'Confirm' : 'Delete'}
				</button>
			</div>
		{:else if ui.kind === 'deleted'}
			<p class="py-8 text-center text-muted-foreground">Removed from your stash.</p>
		{:else}
			<p class="mb-3 text-destructive">{ui.message}</p>
			<button onclick={() => chrome.runtime.openOptionsPage()} class="text-xs text-muted-foreground underline">Extension settings</button>
		{/if}
	</div>

	<footer class="border-t px-4 py-2 text-center text-[11px] text-muted-foreground">
		{isMac ? '⌘⇧E' : 'Alt+Shift+E'} saves any page · right-click a link to save it
	</footer>
</main>
