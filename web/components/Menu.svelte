<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import type { Snippet } from 'svelte';

	// ponytail: a tiny dropdown; swap for bits-ui when menus need submenus or typeahead.
	let { children, label = 'More actions' }: { children: Snippet<[() => void]>; label?: string } = $props();
	let open = $state(false);
	let root: HTMLDivElement;
	const close = () => (open = false);

	function onWindowClick(e: MouseEvent) {
		if (open && !root.contains(e.target as Node)) close();
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && close()} />

<div bind:this={root} class="relative">
	<button
		onclick={() => (open = !open)}
		aria-label={label}
		aria-haspopup="menu"
		aria-expanded={open}
		class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
	>
		<Ellipsis class="size-4" />
	</button>
	{#if open}
		<div role="menu" class="absolute right-0 bottom-full z-30 mb-1 min-w-44 rounded-md border bg-card p-1 text-sm shadow-lg">
			{@render children(close)}
		</div>
	{/if}
</div>
