<script lang="ts">
	import type { Snippet } from 'svelte';

	// ponytail: a tiny click-to-open popover; swap for bits-ui if menus need submenus or typeahead.
	let {
		trigger,
		children,
		label,
		buttonClass = '',
		panelClass = 'left-0 bottom-full mb-2',
	}: { trigger: Snippet; children: Snippet<[() => void]>; label: string; buttonClass?: string; panelClass?: string } = $props();
	let open = $state(false);
	let root: HTMLDivElement;
	const close = () => (open = false);
</script>

<svelte:window onclick={(e) => open && !root.contains(e.target as Node) && close()} onkeydown={(e) => e.key === 'Escape' && close()} />

<div bind:this={root} class="relative">
	<button onclick={() => (open = !open)} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} class={buttonClass}>
		{@render trigger()}
	</button>
	{#if open}
		<div role="menu" class="absolute z-40 w-64 rounded-lg border bg-card p-1 text-sm whitespace-nowrap shadow-lg {panelClass}">
			{@render children(close)}
		</div>
	{/if}
</div>
