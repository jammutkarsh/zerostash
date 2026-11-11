<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import { isHttpUrl } from '../../shared/og';
	import type { Bookmark } from '../../shared/schemas';
	import { api, notifyExtension } from '../lib/api';
	import { watchPreview } from '../lib/preview';

	let { onSaved, compact = false }: { onSaved: (b: Bookmark) => void; compact?: boolean } = $props();
	let value = $state('');
	let busy = $state(false);
	let message = $state('');

	async function save() {
		const input = value.trim();
		if (!input || busy) return;
		busy = true;
		message = '';
		try {
			const { bookmark, alreadyExists } = isHttpUrl(input)
				? await api.create({ type: 'link', url: input, source: 'web' })
				: await api.create({ type: 'text', text: input, source: 'web' });
			value = '';
			onSaved(bookmark);
			if (alreadyExists) message = 'Already in your stash.';
			if (bookmark.ogStatus === 'pending') {
				notifyExtension();
				watchPreview(bookmark.id, onSaved);
			}
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void save();
		}
	}
</script>

<div class="flex flex-col rounded-lg border bg-card p-4 shadow-sm">
	<div class="mb-2 flex items-center justify-between">
		<span class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">New item</span>
		<span title="A link becomes a bookmark with a preview; anything else becomes a note." class="text-muted-foreground"><Info class="size-4" /></span>
	</div>
	<textarea
		bind:value
		{onkeydown}
		rows={compact ? 2 : 6}
		aria-label="New bookmark or note"
		placeholder="Paste a link or write a note…"
		class="w-full flex-1 resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
	></textarea>
	{#if message}<p class="mt-1 text-xs text-muted-foreground">{message}</p>{/if}
	<button
		onclick={save}
		disabled={busy || !value.trim()}
		class="mt-3 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40"
	>
		{busy ? 'Saving…' : 'Save'}
	</button>
	<p class="mt-2 text-center text-[11px] text-muted-foreground">Enter to save · Shift+Enter for a new line</p>
</div>
