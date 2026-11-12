<script lang="ts">
	import Smile from '@lucide/svelte/icons/smile';

	// Pick from a grid; no typing. `value` is the chosen emoji or '' for none.
	let { value = $bindable('') }: { value?: string } = $props();
	let open = $state(false);
	let tab = $state(0);
	let root: HTMLDivElement;

	const CATEGORIES: [string, string, string[]][] = [
		['⭐', 'Popular', ['📚', '📌', '⭐', '💡', '🧠', '🔖', '📝', '📎', '🗂️', '📁', '🏷️', '✅', '🚀', '🔥', '❤️', '🎯', '📈', '💼', '🧪', '🛠️', '💻', '🎨', '🎵', '🎬']],
		['😀', 'Faces', ['😀', '😄', '😎', '🤓', '🤔', '😍', '🥳', '😴', '🤯', '😇', '🙃', '😅', '🤩', '😌', '🫠', '👀', '👋', '👍', '🙌', '👏', '💪', '🤝', '✌️', '🫶']],
		['🌿', 'Nature', ['🌱', '🌿', '🌳', '🌵', '🌸', '🌻', '🍁', '🍄', '🌊', '⛰️', '🌙', '☀️', '⭐', '🌈', '❄️', '⚡', '🐶', '🐱', '🦊', '🐻', '🐼', '🦉', '🐝', '🦋']],
		['🍕', 'Food', ['☕', '🍵', '🍺', '🍷', '🍕', '🍔', '🌮', '🍣', '🍜', '🥗', '🍳', '🥐', '🍰', '🍪', '🍫', '🍎', '🍓', '🥑', '🌶️', '🧀', '🍿', '🥤', '🍩', '🧁']],
		['⚽', 'Activities', ['⚽', '🏀', '🎾', '🏓', '🏋️', '🚴', '🏃', '🧘', '🎮', '🎲', '♟️', '🎸', '🎹', '🎧', '🎤', '📷', '🎭', '🎟️', '🏆', '🥇', '🧩', '🪁', '🛹', '🏕️']],
		['✈️', 'Travel', ['✈️', '🚗', '🚲', '🚆', '🚀', '⛵', '🗺️', '🧭', '🏠', '🏢', '🏖️', '🏔️', '🗽', '🗼', '🏛️', '🌍', '🌏', '🌎', '🧳', '⛺', '🛫', '🚇', '🛵', '🚢']],
		['💻', 'Objects', ['💻', '🖥️', '📱', '⌨️', '🖱️', '💾', '📦', '🔧', '🔨', '⚙️', '🔒', '🔑', '💰', '💳', '📅', '⏰', '📖', '📰', '✉️', '📮', '🔬', '🔭', '💊', '🎁']],
		['💬', 'Symbols', ['💬', '💭', '❗', '❓', '⚠️', '♻️', '✔️', '❌', '➕', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '♾️', '💯', '🆕', '🔔', '🎵', '🏁']],
	];

	function pick(emoji: string) {
		value = emoji;
		open = false;
	}
</script>

<svelte:window onclick={(e) => open && !root.contains(e.target as Node) && (open = false)} onkeydown={(e) => open && e.key === 'Escape' && (e.stopPropagation(), (open = false))} />

<div bind:this={root} class="relative">
	<button
		type="button"
		onclick={() => (open = !open)}
		aria-label={value ? `Icon ${value}, change` : 'Choose an icon'}
		title="Choose an icon"
		aria-haspopup="dialog"
		aria-expanded={open}
		class="grid size-10 place-items-center rounded-md border bg-background text-xl hover:bg-muted"
	>
		{#if value}{value}{:else}<Smile class="size-5 text-muted-foreground" />{/if}
	</button>
	{#if open}
		<div role="dialog" aria-label="Choose an icon" class="absolute top-full left-0 z-50 mt-1 w-72 rounded-lg border bg-card p-2 shadow-xl">
			<div class="mb-2 flex gap-0.5 border-b pb-1.5">
				{#each CATEGORIES as [icon, label], i (label)}
					<button type="button" onclick={() => (tab = i)} title={label} aria-label={label} class="grid size-8 place-items-center rounded-md text-base {tab === i ? 'bg-muted' : 'opacity-60 hover:opacity-100'}">{icon}</button>
				{/each}
			</div>
			<p class="mb-1 px-1 text-xs font-medium text-muted-foreground">{CATEGORIES[tab][1]}</p>
			<div class="grid grid-cols-8 gap-0.5">
				{#each CATEGORIES[tab][2] as emoji (emoji)}
					<button type="button" onclick={() => pick(emoji)} class="grid size-8 place-items-center rounded-md text-lg hover:bg-muted {value === emoji ? 'bg-muted ring-1 ring-accent' : ''}">{emoji}</button>
				{/each}
			</div>
			{#if value}
				<button type="button" onclick={() => pick('')} class="mt-2 w-full rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">Remove icon</button>
			{/if}
		</div>
	{/if}
</div>
