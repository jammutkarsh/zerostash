<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Bookmark } from '../../shared/schemas';
	import { api, type View } from '../lib/api';
	import BookmarkCard from './BookmarkCard.svelte';
	import QuickAdd from './QuickAdd.svelte';

	let { view, query = '', layout = 'masonry' }: { view: View; query?: string; layout?: 'masonry' | 'list' } = $props();

	let items = $state<Bookmark[]>([]);
	let cursor = $state<string | null>(null);
	let loading = $state(false);
	let done = $state(false);
	let error = $state('');
	let width = $state(0);
	let sentinel: HTMLDivElement;

	const showAdd = $derived(view === 'home' && !query);
	const MIN_COLUMN = 280;
	const GAP = 16;
	const columnCount = $derived(layout === 'list' ? 1 : Math.min(5, Math.max(1, Math.floor((width + GAP) / (MIN_COLUMN + GAP)))));

	type Entry = { kind: 'add' } | { kind: 'bookmark'; bookmark: Bookmark };
	const entries = $derived<Entry[]>([
		...(showAdd ? [{ kind: 'add' } as const] : []),
		...items.map((bookmark) => ({ kind: 'bookmark' as const, bookmark })),
	]);
	// Round-robin into columns so the grid reads left to right, newest first
	// (CSS columns would read top to bottom).
	const columns = $derived(Array.from({ length: columnCount }, (_, c) => entries.filter((_, i) => i % columnCount === c)));

	async function loadMore() {
		if (loading || done) return;
		loading = true;
		try {
			const page = await api.list(view, cursor ?? undefined, query || undefined);
			items.push(...page.items);
			cursor = page.nextCursor;
			done = !page.nextCursor;
		} catch (e) {
			error = String(e);
			done = true;
		} finally {
			loading = false;
		}
		// IntersectionObserver only fires on changes: if this page didn't push the
		// sentinel out of range (short notes, wide screens), keep loading.
		await tick();
		if (!done && sentinel.getBoundingClientRect().top < innerHeight + 600) void loadMore();
	}

	onMount(() => {
		const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: '600px' });
		io.observe(sentinel);
		return () => io.disconnect();
	});

	function upsert(b: Bookmark) {
		const i = items.findIndex((x) => x.id === b.id);
		const belongs = query ? true : view === 'favourites' ? b.favourited : view === 'archive' ? b.archived : !b.archived;
		if (i === -1) {
			if (belongs) items.unshift(b);
		} else if (belongs) items[i] = b;
		else items.splice(i, 1);
	}

	function remove(id: string) {
		items = items.filter((x) => x.id !== id);
	}

	const empty: Record<View, string> = {
		home: 'Your stash is empty. Paste a link above, or save pages with the browser extension.',
		favourites: 'Star a bookmark and it shows up here.',
		archive: 'Archived bookmarks leave Home but stay searchable. Nothing archived yet.',
	};
</script>

<div bind:clientWidth={width} class={layout === 'list' ? 'mx-auto max-w-3xl' : ''}>
	<div class="flex items-start gap-4">
		{#each columns as column, c (c)}
			<div class="flex min-w-0 flex-1 flex-col gap-4">
				{#each column as entry (entry.kind === 'add' ? 'add' : entry.bookmark.id)}
					{#if entry.kind === 'add'}
						<QuickAdd onSaved={upsert} compact={layout === 'list'} />
					{:else}
						<BookmarkCard bookmark={entry.bookmark} {layout} onChange={upsert} onRemove={remove} />
					{/if}
				{/each}
			</div>
		{/each}
	</div>
</div>

<div bind:this={sentinel} class="py-10 text-center text-sm text-muted-foreground">
	{#if error}
		<span class="text-destructive">{error}</span>
	{:else if loading}
		Loading…
	{:else if done && items.length === 0}
		{query ? `No bookmarks match “${query}”.` : empty[view]}
	{/if}
</div>
