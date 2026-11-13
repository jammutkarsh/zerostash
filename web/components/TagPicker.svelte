<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import TagIcon from '@lucide/svelte/icons/tag';
	import type { Bookmark } from '../../shared/schemas';
	import { setTags, tags } from '../lib/store.svelte';
	import Menu from './Menu.svelte';

	// Card button: type to find or create a tag; click a tag to toggle it on this bookmark.
	let { bookmark, buttonClass }: { bookmark: Bookmark; buttonClass: string } = $props();
	let query = $state('');
	let busy = $state(false);

	const attached = $derived(new Set(bookmark.tags.map((t) => t.id)));
	const q = $derived(query.trim());
	const shown = $derived(
		(q ? tags.items.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : [...tags.items].sort((a, b) => +attached.has(b.id) - +attached.has(a.id))).slice(0, 50),
	);
	const exact = $derived(tags.items.some((t) => t.name.toLowerCase() === q.toLowerCase()));

	async function change(c: { attach?: string[]; detach?: string[] }) {
		busy = true;
		await setTags(bookmark.id, c);
		busy = false;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' || !q) return;
		e.preventDefault();
		const match = tags.items.find((t) => t.name.toLowerCase() === q.toLowerCase());
		if (match && attached.has(match.id)) void change({ detach: [match.id] });
		else void change({ attach: [match?.name ?? q] });
		query = '';
	}
</script>

<Menu label="Tags" buttonClass="{buttonClass} {bookmark.tags.length ? 'text-accent' : 'text-muted-foreground hover:text-foreground'}" panelClass="right-0 top-full mt-1" flipClass="right-0 bottom-full mb-1">
	{#snippet trigger()}<TagIcon class="size-4" />{/snippet}
	{#snippet children()}
		<p class="px-2.5 pt-1 pb-1.5 text-xs font-semibold text-muted-foreground">Tags</p>
		<input
			bind:value={query}
			{onkeydown}
			{@attach (el) => {
				query = '';
				el.focus();
			}}
			disabled={busy}
			type="search"
			aria-label="Find or add a tag"
			placeholder="Find or add a tag…"
			class="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-accent"
		/>
		<div class="max-h-64 overflow-y-auto">
			{#if q && !exact}
				<button onclick={() => (void change({ attach: [q] }), (query = ''))} class="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-muted">
					<Plus class="size-4 shrink-0" /><span class="min-w-0 truncate">Add “{q}”</span>
				</button>
			{/if}
			{#each shown as t (t.id)}
				{@const on = attached.has(t.id)}
				<button
					onclick={() => change(on ? { detach: [t.id] } : { attach: [t.name] })}
					role="menuitemcheckbox"
					aria-checked={on}
					class="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-muted"
				>
					<span class="min-w-0 flex-1 truncate">{t.name}</span>
					<span class="text-xs tabular-nums text-muted-foreground">{t.numBookmarks}</span>
					{#if on}<Check class="size-4 shrink-0 text-accent" />{/if}
				</button>
			{:else}
				{#if !q}<p class="px-2.5 py-1.5 text-sm text-muted-foreground">No tags yet. Type one and press Enter.</p>{/if}
			{/each}
		</div>
	{/snippet}
</Menu>
