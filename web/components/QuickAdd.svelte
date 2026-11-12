<script lang="ts">
	import { isHttpUrl } from '../../shared/og';
	import { api, notifyExtension } from '../lib/api';
	import { watchPreview } from '../lib/preview';
	import { upsert } from '../lib/store.svelte';

	let { compact = false }: { compact?: boolean } = $props();
	let value = $state('');
	let busy = $state(false);
	let message = $state('');
	let focused = $state(false);
	// One line until used, so the first screen shows bookmarks, not an empty box. Stays open while
	// there's text, so a Save click that blurs the field (Safari) still lands on the button.
	const open = $derived(focused || !!value.trim() || busy);

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
			upsert(bookmark);
			if (alreadyExists) message = 'Already in your stash.';
			if (bookmark.ogStatus === 'pending') {
				notifyExtension();
				watchPreview(bookmark.id, upsert);
			}
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// Enter saves, Shift+Enter adds a line.
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void save();
		} else if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
	}
</script>

<div class="flex flex-col rounded-lg border bg-card p-4 shadow-sm" onfocusin={() => (focused = true)} onfocusout={() => (focused = false)}>
	<p class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">New item</p>
	<textarea
		id="quick-add"
		bind:value
		{onkeydown}
		rows={open ? (compact ? 2 : 5) : 1}
		aria-label="New bookmark or note"
		placeholder="Paste a link or write a note…"
		class="w-full flex-1 resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
	></textarea>
	{#if message}<p class="mt-1 text-xs text-muted-foreground">{message}</p>{/if}
	{#if open}
		<button
			onclick={save}
			disabled={busy || !value.trim()}
			class="mt-3 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40"
		>
			{busy ? 'Saving…' : 'Save'}
		</button>
	{/if}
</div>
