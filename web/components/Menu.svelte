<script lang="ts">
	import { tick, type Snippet } from 'svelte';

	// ponytail: a tiny click-to-open popover; swap for bits-ui if menus need submenus or typeahead.
	let {
		trigger,
		children,
		label,
		buttonClass = '',
		panelClass = 'left-0 bottom-full mb-2',
		flipClass = '',
	}: {
		trigger: Snippet;
		children: Snippet<[() => void]>;
		label: string;
		buttonClass?: string;
		panelClass?: string;
		/** Placement to fall back to when `panelClass` would run off the bottom of the window. */
		flipClass?: string;
	} = $props();
	let open = $state(false);
	let flipped = $state(false);
	let root: HTMLDivElement;
	let panel = $state<HTMLDivElement>();
	const close = () => (open = false);

	async function toggle() {
		open = !open;
		flipped = false;
		if (!open || !flipClass) return;
		await tick(); // measured before the browser paints, so there is no visible jump
		const r = panel!.getBoundingClientRect();
		flipped = r.bottom > innerHeight - 8 && r.height < root.getBoundingClientRect().top;
	}
</script>

<svelte:window onclick={(e) => open && !root.contains(e.target as Node) && close()} onkeydown={(e) => e.key === 'Escape' && close()} />

<div bind:this={root} class="relative">
	<button onclick={toggle} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} class={buttonClass}>
		{@render trigger()}
	</button>
	{#if open}
		<div bind:this={panel} role="menu" class="absolute z-40 w-64 rounded-lg border bg-card p-1 text-sm whitespace-nowrap shadow-lg {flipped ? flipClass : panelClass}">
			{@render children(close)}
		</div>
	{/if}
</div>
