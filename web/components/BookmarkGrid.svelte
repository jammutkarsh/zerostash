<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Bookmark } from '../../shared/schemas';
	import { api, type View } from '../lib/api';
	import BookmarkCard from './BookmarkCard.svelte';
	import QuickAdd from './QuickAdd.svelte';

	let { view }: { view: View } = $props();

	let items = $state<Bookmark[]>([]);
	let cursor = $state<string | null>(null);
	let loading = $state(false);
	let done = $state(false);
	let error = $state('');
	let sentinel: HTMLDivElement;

	async function loadMore() {
		if (loading || done) return;
		loading = true;
		try {
			const page = await api.list(view, cursor ?? undefined);
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
		const belongs = view === 'favourites' ? b.favourited : view === 'archive' ? b.archived : !b.archived;
		if (i === -1) {
			if (belongs) items.unshift(b);
		} else if (belongs) items[i] = b;
		else items.splice(i, 1);
	}

	function remove(id: string) {
		items = items.filter((x) => x.id !== id);
	}
</script>

<div class="columns-1 gap-4 sm:columns-2 lg:columns-3 2xl:columns-4">
	{#if view === 'home'}
		<QuickAdd onSaved={upsert} />
	{/if}
	{#each items as bookmark (bookmark.id)}
		<BookmarkCard {bookmark} onChange={upsert} onRemove={remove} />
	{/each}
</div>

<div bind:this={sentinel} class="py-8 text-center text-sm text-muted-foreground">
	{#if error}<span class="text-destructive">{error}</span>
	{:else if loading}Loading…
	{:else if done && items.length === 0 && view !== 'home'}Nothing here yet.
	{/if}
</div>
