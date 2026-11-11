<script lang="ts">
	import Archive from '@lucide/svelte/icons/archive';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { Bookmark } from '../../shared/schemas';
	import { api } from '../lib/api';

	let { bookmark, onChange, onRemove }: { bookmark: Bookmark; onChange: (b: Bookmark) => void; onRemove: (id: string) => void } =
		$props();

	let imageFailed = $state(false);
	let confirmDelete = $state(false);
	const domain = $derived(bookmark.url ? new URL(bookmark.url).hostname.replace(/^www\./, '') : null);
	const date = $derived(new Date(bookmark.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));

	async function toggle(field: 'favourited' | 'archived') {
		onChange(await api.patch(bookmark.id, { [field]: !bookmark[field] }));
	}

	async function remove() {
		if (!confirmDelete) {
			confirmDelete = true;
			setTimeout(() => (confirmDelete = false), 3000);
			return;
		}
		await api.remove(bookmark.id);
		onRemove(bookmark.id);
	}
</script>

<article class="group mb-4 break-inside-avoid overflow-hidden rounded-xl border bg-card shadow-sm">
	{#if bookmark.imageUrl && !imageFailed}
		<a href={bookmark.url} target="_blank" rel="noopener noreferrer">
			<img
				src={bookmark.imageUrl}
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				onerror={() => (imageFailed = true)}
				class="max-h-64 w-full bg-muted object-cover"
			/>
		</a>
	{/if}
	<div class="grid gap-2 p-3">
		{#if bookmark.type === 'link'}
			<a href={bookmark.url} target="_blank" rel="noopener noreferrer" class="font-medium leading-snug hover:underline">
				{bookmark.title || bookmark.url}
			</a>
			{#if bookmark.description}
				<p class="line-clamp-3 text-sm text-muted-foreground">{bookmark.description}</p>
			{/if}
		{:else}
			{#if bookmark.title}<p class="font-medium">{bookmark.title}</p>{/if}
			<p class="whitespace-pre-wrap text-sm">{bookmark.text}</p>
		{/if}
		{#if bookmark.note}
			<p class="rounded-md bg-muted px-2 py-1 text-sm">{bookmark.note}</p>
		{/if}
		<footer class="flex items-center gap-2 text-xs text-muted-foreground">
			{#if domain}
				{#if bookmark.faviconUrl}
					<img src={bookmark.faviconUrl} alt="" class="size-4 rounded-sm" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
				{/if}
				<span class="truncate">{bookmark.siteName || domain}</span>
				<span>·</span>
			{/if}
			<span class="shrink-0">{date}</span>
			{#if bookmark.ogStatus === 'pending'}<span class="shrink-0">· fetching preview…</span>{/if}
			<div class="ml-auto flex shrink-0 gap-0.5 opacity-60 transition group-hover:opacity-100">
				<button onclick={() => toggle('favourited')} aria-label="Favourite" class="rounded p-1 hover:bg-muted">
					<Star class="size-4 {bookmark.favourited ? 'fill-accent text-accent' : ''}" />
				</button>
				<button onclick={() => toggle('archived')} aria-label={bookmark.archived ? 'Unarchive' : 'Archive'} class="rounded p-1 hover:bg-muted">
					{#if bookmark.archived}<ArchiveRestore class="size-4" />{:else}<Archive class="size-4" />{/if}
				</button>
				<button onclick={remove} aria-label="Delete" class="rounded p-1 hover:bg-muted {confirmDelete ? 'text-destructive' : ''}">
					<Trash2 class="size-4" />
				</button>
			</div>
		</footer>
		{#if confirmDelete}<p class="text-right text-xs text-destructive">Click delete again to confirm</p>{/if}
	</div>
</article>
