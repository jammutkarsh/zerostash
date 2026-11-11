<script lang="ts">
	import Archive from '@lucide/svelte/icons/archive';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import StickyNote from '@lucide/svelte/icons/sticky-note';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { Bookmark } from '../../shared/schemas';
	import { api } from '../lib/api';
	import { relativeTime } from '../lib/time';
	import Menu from './Menu.svelte';

	let {
		bookmark,
		layout = 'masonry',
		onChange,
		onRemove,
	}: { bookmark: Bookmark; layout?: 'masonry' | 'list'; onChange: (b: Bookmark) => void; onRemove: (id: string) => void } = $props();

	let imageFailed = $state(false);
	let confirmDelete = $state(false);
	let copied = $state(false);
	const domain = $derived(bookmark.url ? new URL(bookmark.url).hostname.replace(/^www\./, '') : null);
	const when = $derived(relativeTime(bookmark.createdAt));
	const fullDate = $derived(new Date(bookmark.createdAt).toLocaleString());
	const showImage = $derived(!!bookmark.imageUrl && !imageFailed);
	const loadingPreview = $derived(bookmark.type === 'link' && bookmark.ogStatus === 'pending');

	async function toggle(field: 'favourited' | 'archived') {
		onChange(await api.patch(bookmark.id, { [field]: !bookmark[field] }));
	}

	async function copyLink(close: () => void) {
		if (!bookmark.url) return;
		await navigator.clipboard.writeText(bookmark.url);
		copied = true;
		setTimeout(() => ((copied = false), close()), 900);
	}

	async function remove() {
		if (!confirmDelete) return void (confirmDelete = true);
		await api.remove(bookmark.id);
		onRemove(bookmark.id);
	}
</script>

{#snippet actions()}
	<div class="ml-auto flex shrink-0 items-center gap-0.5">
		<button
			onclick={() => toggle('favourited')}
			aria-label={bookmark.favourited ? 'Unfavourite' : 'Favourite'}
			aria-pressed={bookmark.favourited}
			class="rounded p-1 hover:bg-muted {bookmark.favourited ? 'text-amber-400' : 'text-muted-foreground hover:text-foreground'}"
		>
			<Star class="size-4 {bookmark.favourited ? 'fill-amber-400' : ''}" />
		</button>
		<Menu>
			{#snippet children(close)}
				{#if bookmark.url}
					<a href={bookmark.url} target="_blank" rel="noopener noreferrer" onclick={close} role="menuitem" class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
						<ExternalLink class="size-4" />Open link
					</a>
					<button onclick={() => copyLink(close)} role="menuitem" class="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
						<Copy class="size-4" />{copied ? 'Copied ✓' : 'Copy link'}
					</button>
				{/if}
				<button onclick={() => (close(), toggle('archived'))} role="menuitem" class="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
					{#if bookmark.archived}<ArchiveRestore class="size-4" />Unarchive{:else}<Archive class="size-4" />Archive{/if}
				</button>
				<button
					onclick={remove}
					onmouseleave={() => (confirmDelete = false)}
					role="menuitem"
					class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-destructive hover:bg-muted"
				>
					<Trash2 class="size-4" />{confirmDelete ? 'Click again to delete' : 'Delete'}
				</button>
			{/snippet}
		</Menu>
	</div>
{/snippet}

{#snippet meta()}
	<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
		{#if domain}
			{#if bookmark.faviconUrl}
				<img src={bookmark.faviconUrl} alt="" class="size-3.5 shrink-0 rounded-sm" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
			{/if}
			<a href={bookmark.url} target="_blank" rel="noopener noreferrer" class="min-w-0 truncate hover:underline">{domain}</a>
			<span aria-hidden="true">•</span>
		{/if}
		<time class="shrink-0" datetime={new Date(bookmark.createdAt).toISOString()} title={fullDate}>{when}</time>
	</div>
{/snippet}

{#if layout === 'list'}
	<article class="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-sm">
		<div class="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-muted {loadingPreview ? 'animate-pulse' : ''}" title={loadingPreview ? 'Fetching preview…' : undefined}>
			{#if showImage}
				<img src={bookmark.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (imageFailed = true)} class="size-full object-cover" />
			{:else if bookmark.type === 'text'}
				<StickyNote class="size-5 text-muted-foreground" />
			{:else if bookmark.faviconUrl}
				<img src={bookmark.faviconUrl} alt="" class="size-6" referrerpolicy="no-referrer" />
			{/if}
		</div>
		<div class="grid min-w-0 flex-1 grid-cols-1 gap-1">
			{#if bookmark.type === 'link'}
				<a href={bookmark.url} target="_blank" rel="noopener noreferrer" class="truncate font-medium hover:underline">{bookmark.title || bookmark.url}</a>
			{:else}
				<p class="truncate font-medium">{bookmark.title || bookmark.text}</p>
			{/if}
			{@render meta()}
		</div>
		{@render actions()}
	</article>
{:else}
	<article class="rounded-lg border bg-card shadow-sm">
		{#if showImage}
			<a href={bookmark.url} target="_blank" rel="noopener noreferrer" class="block overflow-hidden rounded-t-lg" tabindex="-1">
				<img src={bookmark.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (imageFailed = true)} class="max-h-60 w-full bg-muted object-cover" />
			</a>
		{:else if loadingPreview}
			<div class="h-28 animate-pulse rounded-t-lg bg-muted" title="Fetching preview…"></div>
		{/if}
		<div class="grid grid-cols-1 gap-2 p-3">
			{#if bookmark.type === 'link'}
				<a href={bookmark.url} target="_blank" rel="noopener noreferrer" class="line-clamp-3 text-[15px] leading-snug font-medium break-words hover:underline">
					{bookmark.title || bookmark.url}
				</a>
				{#if bookmark.description}
					<p class="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{bookmark.description}</p>
				{/if}
			{:else}
				{#if bookmark.title}<p class="font-medium">{bookmark.title}</p>{/if}
				<p class="line-clamp-[12] text-sm leading-relaxed whitespace-pre-wrap break-words">{bookmark.text}</p>
			{/if}
			{#if bookmark.note}
				<p class="rounded-md border-l-2 border-accent bg-muted/60 px-2.5 py-1.5 text-sm">{bookmark.note}</p>
			{/if}
			<footer class="flex min-w-0 items-center gap-2 pt-1">
				{@render meta()}
				{@render actions()}
			</footer>
		</div>
	</article>
{/if}
