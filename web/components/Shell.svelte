<script lang="ts">
	import Archive from '@lucide/svelte/icons/archive';
	import House from '@lucide/svelte/icons/house';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Moon from '@lucide/svelte/icons/moon';
	import Star from '@lucide/svelte/icons/star';
	import Sun from '@lucide/svelte/icons/sun';
	import { api, type View } from '../lib/api';
	import { navigate, route } from '../lib/router.svelte';
	import { setSessionHint } from '../lib/session';
	import BookmarkGrid from './BookmarkGrid.svelte';

	const nav: { path: string; view: View; label: string; icon: typeof House }[] = [
		{ path: '/dashboard', view: 'home', label: 'Home', icon: House },
		{ path: '/dashboard/favourites', view: 'favourites', label: 'Favourites', icon: Star },
		{ path: '/dashboard/archive', view: 'archive', label: 'Archive', icon: Archive },
	];
	const current = $derived(nav.find((n) => n.path === route.path) ?? nav[0]);
	let dark = $state(document.documentElement.classList.contains('dark'));

	function toggleTheme() {
		dark = !dark;
		document.documentElement.classList.toggle('dark', dark);
		try {
			localStorage.setItem('theme', dark ? 'dark' : 'light');
		} catch {}
	}

	async function logout() {
		await api.logout();
		setSessionHint(false);
		navigate('/');
	}
</script>

<div class="flex min-h-dvh">
	<aside class="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r p-3 md:flex">
		<div class="mb-4 flex items-center gap-2 px-2 pt-1">
			<img src="/favicon.svg" alt="" class="size-6" />
			<span class="font-semibold">Zerostash</span>
		</div>
		{#each nav as item (item.path)}
			<a
				href={item.path}
				onclick={(e) => (e.preventDefault(), navigate(item.path))}
				class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm {current.path === item.path
					? 'bg-muted font-medium'
					: 'text-muted-foreground hover:bg-muted'}"
			>
				<item.icon class="size-4" />{item.label}
			</a>
		{/each}
	</aside>

	<div class="min-w-0 flex-1">
		<header class="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/80 px-4 py-2 backdrop-blur">
			<nav class="flex gap-1 md:hidden">
				{#each nav as item (item.path)}
					<a
						href={item.path}
						aria-label={item.label}
						onclick={(e) => (e.preventDefault(), navigate(item.path))}
						class="rounded-md p-2 {current.path === item.path ? 'bg-muted' : 'text-muted-foreground'}"
					>
						<item.icon class="size-4" />
					</a>
				{/each}
			</nav>
			<h1 class="font-medium">{current.label}</h1>
			<div class="ml-auto flex gap-1">
				<button onclick={toggleTheme} aria-label="Toggle theme" class="rounded-md p-2 text-muted-foreground hover:bg-muted">
					{#if dark}<Sun class="size-4" />{:else}<Moon class="size-4" />{/if}
				</button>
				<button onclick={logout} aria-label="Sign out" class="rounded-md p-2 text-muted-foreground hover:bg-muted">
					<LogOut class="size-4" />
				</button>
			</div>
		</header>
		<main class="p-4">
			{#key current.view}
				<BookmarkGrid view={current.view} />
			{/key}
		</main>
	</div>
</div>
