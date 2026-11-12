<script lang="ts">
	import Archive from '@lucide/svelte/icons/archive';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import Check from '@lucide/svelte/icons/check';
	import Link from '@lucide/svelte/icons/link';
	import StickyNote from '@lucide/svelte/icons/sticky-note';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { Bookmark } from '../../shared/schemas';
	import { remove, toggle } from '../lib/store.svelte';
	import ListPicker from './ListPicker.svelte';
	import { shortAge } from '../lib/time';

	let {
		bookmark,
		index,
		focused = false,
		layout = 'masonry',
	}: { bookmark: Bookmark; index: number; focused?: boolean; layout?: 'masonry' | 'list' } = $props();

	let imageFailed = $state(false);
	let faviconFailed = $state(false);
	let copied = $state(false);
	const domain = $derived(bookmark.url ? new URL(bookmark.url).hostname.replace(/^www\./, '') : null);
	const fullDate = $derived(new Date(bookmark.createdAt).toLocaleString());
	const showImage = $derived(!!bookmark.imageUrl && !imageFailed);
	const loadingPreview = $derived(bookmark.type === 'link' && bookmark.ogStatus === 'pending');

	export async function copyLink() {
		if (!bookmark.url) return;
		await navigator.clipboard.writeText(bookmark.url);
		copied = true;
		setTimeout(() => (copied = false), 1200);
	}

	// 28px for mouse, 40px for touch. With a mouse, actions show on hover/focus to keep cards calm;
	// a favourited star and the keyboard-focused card always show them.
	const button = 'grid size-7 place-items-center rounded-md transition-colors hover:bg-muted pointer-coarse:size-10';
	const reveal = $derived(
		focused ? '' : 'pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:group-focus-within/card:opacity-100',
	);

	// Drag a card onto a list in the sidebar to add it there.
	function ondragstart(e: DragEvent) {
		e.dataTransfer?.setData('application/x-zerostash-bookmark', bookmark.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
	}
</script>

{#snippet actions()}
	<div class="ml-auto flex shrink-0 items-center">
		{#if bookmark.url}
			<button onclick={copyLink} aria-label="Copy link" title="Copy link (c)" class="{button} {reveal} {copied ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground hover:text-foreground'}">
				{#if copied}<Check class="size-4" />{:else}<Link class="size-4" />{/if}
			</button>
		{/if}
		<ListPicker {bookmark} buttonClass="{button} {reveal}" />
		<button onclick={() => remove(bookmark.id)} aria-label="Delete" title="Delete (#)" class="{button} {reveal} text-muted-foreground hover:text-destructive">
			<Trash2 class="size-4" />
		</button>
		<button
			onclick={() => toggle(bookmark.id, 'archived')}
			aria-label={bookmark.archived ? 'Unarchive' : 'Archive'}
			title={`${bookmark.archived ? 'Unarchive' : 'Archive'} (a)`}
			class="{button} {reveal} text-muted-foreground hover:text-foreground"
		>
			{#if bookmark.archived}<ArchiveRestore class="size-4" />{:else}<Archive class="size-4" />{/if}
		</button>
		<button
			onclick={() => toggle(bookmark.id, 'favourited')}
			aria-pressed={bookmark.favourited}
			aria-label={bookmark.favourited ? 'Unfavourite' : 'Favourite'}
			title={`${bookmark.favourited ? 'Unfavourite' : 'Favourite'} (f)`}
			class="{button} {bookmark.favourited ? 'text-amber-600 dark:text-amber-400' : `text-muted-foreground hover:text-foreground ${reveal}`}"
		>
			<Star class="size-4 {bookmark.favourited ? 'fill-amber-400' : ''}" />
		</button>
	</div>
{/snippet}

{#snippet meta()}
	<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
		{#if bookmark.faviconUrl && domain}
			<img src={bookmark.faviconUrl} alt="" class="size-3.5 shrink-0 rounded-sm" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
		{/if}
		{#if domain}
			<a href={bookmark.url} target="_blank" rel="noopener noreferrer" class="min-w-0 truncate hover:underline">{bookmark.siteName || domain}</a>
			<span aria-hidden="true">·</span>
		{:else}
			<StickyNote class="size-3.5 shrink-0" /><span>Note</span><span aria-hidden="true">·</span>
		{/if}
		<time class="shrink-0" datetime={new Date(bookmark.createdAt).toISOString()} title={fullDate}>{shortAge(bookmark.createdAt)}</time>
	</div>
{/snippet}

{#if layout === 'list'}
	<!-- Phones: actions drop below a 2-line title instead of squeezing it to a few characters. -->
	<article
		data-entry={index}
		draggable="true"
		{ondragstart}
		class="group/card grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-lg border bg-card p-2.5 shadow-sm transition-shadow sm:grid-cols-[auto_minmax(0,1fr)_auto] {focused ? 'ring-2 ring-accent' : ''}"
	>
		<div class="row-span-2 grid size-12 shrink-0 place-items-center sm:row-span-1 overflow-hidden rounded-md bg-muted {loadingPreview ? 'animate-pulse' : ''}">
			{#if showImage}
				<img src={bookmark.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (imageFailed = true)} class="size-full object-cover" />
			{:else if bookmark.type === 'text'}
				<StickyNote class="size-5 text-muted-foreground" />
			{:else if bookmark.faviconUrl && !faviconFailed}
				<img src={bookmark.faviconUrl} alt="" class="size-6" referrerpolicy="no-referrer" onerror={() => (faviconFailed = true)} />
			{:else if domain}
				<span aria-hidden="true" class="text-lg font-semibold text-muted-foreground uppercase">{domain[0]}</span>
			{/if}
		</div>
		<div class="grid min-w-0 flex-1 grid-cols-1 gap-0.5">
			{#if bookmark.type === 'link'}
				<h3 class="line-clamp-2 text-sm font-medium break-words sm:truncate">
					<a href={bookmark.url} target="_blank" rel="noopener noreferrer" class="hover:underline">{bookmark.title || bookmark.url}</a>
				</h3>
			{:else}
				<h3 class="line-clamp-2 text-sm font-medium break-words sm:truncate">{bookmark.title || bookmark.text}</h3>
			{/if}
			{@render meta()}
		</div>
		{@render actions()}
	</article>
{:else}
	<article data-entry={index} draggable="true" {ondragstart} class="group/card rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md {focused ? 'ring-2 ring-accent' : ''}">
		{#if showImage}
			<a href={bookmark.url} target="_blank" rel="noopener noreferrer" class="block overflow-hidden rounded-t-lg" tabindex="-1" aria-hidden="true" draggable="false">
				<img src={bookmark.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (imageFailed = true)} class="aspect-[1.91/1] w-full bg-muted object-cover" />
			</a>
		{:else if loadingPreview}
			<div class="aspect-[1.91/1] animate-pulse rounded-t-lg bg-muted" title="Fetching preview…"></div>
		{/if}
		<div class="grid grid-cols-1 gap-1.5 px-3.5 pt-3 pb-2">
			{#if bookmark.type === 'link'}
				<h3 class="line-clamp-3 text-[15px] leading-snug font-semibold break-words">
					<a href={bookmark.url} target="_blank" rel="noopener noreferrer" class="hover:underline">{bookmark.title || bookmark.url}</a>
				</h3>
				{#if bookmark.description}
					<p class="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{bookmark.description}</p>
				{/if}
			{:else}
				{#if bookmark.title}<h3 class="font-semibold">{bookmark.title}</h3>{/if}
				<p class="line-clamp-[12] text-sm leading-relaxed break-words whitespace-pre-wrap">{bookmark.text}</p>
			{/if}
			{#if bookmark.note}
				<p class="rounded-md border-l-2 border-accent bg-muted/60 px-2.5 py-1.5 text-sm">{bookmark.note}</p>
			{/if}
			<footer class="-mr-1.5 flex min-w-0 items-center gap-2 pt-1">
				{@render meta()}
				{@render actions()}
			</footer>
		</div>
	</article>
{/if}
