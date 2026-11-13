<script lang="ts">
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import { isHttpUrl } from '../../shared/og';
	import { api, errorMessage, saveFile } from '../lib/api';
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
			const { alreadyExists, ...bookmark } = await api.bookmarks.createBookmark.mutate(
				isHttpUrl(input) ? { type: 'link', url: input, source: 'web' } : { type: 'text', text: input, source: 'web' },
			);
			value = '';
			upsert(bookmark);
			if (alreadyExists) message = 'Already in your stash.';
			if (bookmark.content.type === 'link' && bookmark.content.crawlStatus === 'pending') watchPreview(bookmark.id, upsert);
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	let fileInput: HTMLInputElement;
	let dragging = $state(false);
	const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/avif,application/pdf';

	async function upload(files: Iterable<File>) {
		busy = true;
		message = '';
		try {
			for (const file of files) {
				const { alreadyExists: _, ...bookmark } = await saveFile(file);
				upsert(bookmark);
			}
		} catch (e) {
			message = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	// Pasting an image (a screenshot) uploads it; pasted text stays text.
	function onpaste(e: ClipboardEvent) {
		const files = [...(e.clipboardData?.files ?? [])];
		if (!files.length) return;
		e.preventDefault();
		void upload(files);
	}

	function ondrop(e: DragEvent) {
		dragging = false;
		const files = [...(e.dataTransfer?.files ?? [])];
		if (!files.length) return;
		e.preventDefault();
		void upload(files);
	}

	// Enter saves, Shift+Enter adds a line.
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void save();
		} else if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
	}
</script>

<div
	class="flex flex-col rounded-lg border bg-card p-4 shadow-sm {dragging ? 'ring-2 ring-accent' : ''}"
	onfocusin={() => (focused = true)}
	onfocusout={() => (focused = false)}
	ondragover={(e) => e.dataTransfer?.types.includes('Files') && (e.preventDefault(), (dragging = true))}
	ondragleave={() => (dragging = false)}
	{ondrop}
	role="group"
	aria-label="New item"
>
	<div class="mb-2 flex items-center">
		<p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">New item</p>
		<button
			type="button"
			onclick={() => fileInput.click()}
			disabled={busy}
			aria-label="Upload an image or PDF"
			title="Upload an image or PDF (or drop / paste one here)"
			class="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10"
		>
			<Paperclip class="size-4" />
		</button>
		<input bind:this={fileInput} type="file" accept={ACCEPT} multiple hidden onchange={(e) => void upload(e.currentTarget.files ?? [])} />
	</div>
	<textarea
		id="quick-add"
		bind:value
		{onkeydown}
		{onpaste}
		rows={open ? (compact ? 2 : 5) : 1}
		aria-label="New bookmark or note"
		placeholder="Paste a link, write a note, or drop an image or PDF…"
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
