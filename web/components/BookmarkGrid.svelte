<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Bookmark } from '../../shared/schemas';
	import type { View } from '../lib/api';
	import { deltaKept, ensureFeed, lists, loadMore, refresh, remove, toggle } from '../lib/store.svelte';
	import BookmarkCard from './BookmarkCard.svelte';
	import QuickAdd from './QuickAdd.svelte';

	// Keyed by view|query in Shell, so `feed` is fixed for this instance.
	let {
		view,
		query = '',
		listId = '',
		layout = 'masonry',
	}: { view: View; query?: string; listId?: string; layout?: 'masonry' | 'list' } = $props();
	// svelte-ignore state_referenced_locally
	const feed = ensureFeed(view, query, listId);

	let width = $state(0);
	let focused = $state(-1);
	let sentinel: HTMLDivElement;
	let cards: Record<number, BookmarkCard> = {};

	const showAdd = $derived(view === 'home' && !query && !listId);
	const GAP = 16;
	const columnCount = $derived(
		layout === 'list' ? (width >= 900 ? 2 : 1) : Math.min(5, Math.max(1, Math.floor((width + GAP) / (280 + GAP)))),
	);

	type Entry = { kind: 'add' } | { kind: 'bookmark'; bookmark: Bookmark };
	const entries = $derived<Entry[]>([
		...(showAdd ? [{ kind: 'add' } as const] : []),
		...feed.items.map((bookmark) => ({ kind: 'bookmark' as const, bookmark })),
	]);
	// Round-robin into columns so the grid reads left to right, newest first.
	const columns = $derived(
		Array.from({ length: columnCount }, (_, c) => entries.map((entry, i) => ({ entry, i })).filter(({ i }) => i % columnCount === c)),
	);

	async function more() {
		await loadMore(feed);
		// IntersectionObserver only fires on changes: if this page didn't push the
		// sentinel out of range (short notes, wide screens), keep loading.
		await tick();
		if (!feed.done && !feed.error && sentinel.getBoundingClientRect().top < innerHeight + 600) void more();
	}

	onMount(() => {
		// Cached data is already on screen. Delta sync keeps the main views and manual lists
		// current; searches and smart lists re-run their first page quietly.
		if (feed.items.length && !deltaKept(feed)) void refresh(feed);
		const io = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: '600px' });
		io.observe(sentinel);
		return () => io.disconnect();
	});

	// ---- keyboard navigation (Karakeep's keys) ----
	const first = $derived(showAdd ? 1 : 0);
	const current = $derived(entries[focused]?.kind === 'bookmark' ? (entries[focused] as { bookmark: Bookmark }).bookmark : null);

	function move(delta: number) {
		const last = entries.length - 1;
		if (last < first) return;
		focused = focused < first ? first : Math.min(last, Math.max(first, focused + delta));
		void tick().then(() => document.querySelector(`[data-entry="${focused}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
		if (focused > last - columnCount * 2) void more();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
		const arrows = focused >= first; // arrows only steer once something is selected; otherwise they scroll
		const handlers: Record<string, () => void> = {
			j: () => move(columnCount),
			k: () => move(-columnCount),
			h: () => move(-1),
			l: () => move(1),
			...(arrows ? { ArrowDown: () => move(columnCount), ArrowUp: () => move(-columnCount), ArrowLeft: () => move(-1), ArrowRight: () => move(1) } : {}),
			Escape: () => (focused = -1),
			n: () => document.getElementById('quick-add')?.focus(),
		};
		if (current) {
			const b = current;
			Object.assign(handlers, {
				o: () => b.url && window.open(b.url, '_blank', 'noopener'),
				Enter: () => b.url && window.open(b.url, '_blank', 'noopener'),
				f: () => toggle(b.id, 'favourited'),
				a: () => toggle(b.id, 'archived'),
				c: () => cards[focused]?.copyLink(),
				'#': () => remove(b.id),
				Delete: () => remove(b.id),
			});
		}
		const handler = handlers[e.key];
		if (handler) {
			e.preventDefault();
			handler();
		}
	}

	$effect(() => {
		if (focused >= entries.length) focused = entries.length - 1; // after deleting the last card
	});

	const empty: Record<View, string> = {
		home: 'Your stash is empty. Paste a link above, or save pages with the browser extension.',
		favourites: 'Star a bookmark and it shows up here.',
		archive: 'Archived bookmarks leave Home but stay searchable. Nothing archived yet.',
	};
</script>

<svelte:window {onkeydown} />

<div bind:clientWidth={width} class="flex items-start gap-4">
	{#each columns as column, c (c)}
		<div class="flex min-w-0 flex-1 flex-col {layout === 'list' ? 'gap-3' : 'gap-4'}">
			{#each column as { entry, i } (entry.kind === 'add' ? 'add' : entry.bookmark.id)}
				{#if entry.kind === 'add'}
					<QuickAdd compact={layout === 'list'} />
				{:else}
					<BookmarkCard bind:this={cards[i]} bookmark={entry.bookmark} index={i} focused={focused === i} {layout} />
				{/if}
			{/each}
		</div>
	{/each}
</div>

<div bind:this={sentinel} class="py-10 text-center text-sm text-muted-foreground">
	{#if feed.error && !feed.items.length}
		<span class="text-destructive">{feed.error}</span>
	{:else if feed.loading && !feed.items.length}
		Loading…
	{:else if feed.done && !feed.items.length}
		{#if listId}
			{lists.items.find((l) => l.id === listId)?.kind === 'smart'
				? 'Nothing matches this smart list yet.'
				: 'This list is empty. Add bookmarks with the list button on a card, or drag a card onto the list in the sidebar.'}
		{:else}
			{query ? `No bookmarks match “${query}”.` : empty[view]}
		{/if}
	{/if}
</div>
