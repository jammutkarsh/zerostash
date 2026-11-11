<script lang="ts">
	import Archive from '@lucide/svelte/icons/archive';
	import Braces from '@lucide/svelte/icons/braces';
	import House from '@lucide/svelte/icons/house';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Moon from '@lucide/svelte/icons/moon';
	import Puzzle from '@lucide/svelte/icons/puzzle';
	import Rows3 from '@lucide/svelte/icons/rows-3';
	import Search from '@lucide/svelte/icons/search';
	import Sun from '@lucide/svelte/icons/sun';
	import X from '@lucide/svelte/icons/x';
	import pkg from '../../package.json';
	import { api, type View } from '../lib/api';
	import { navigate, route } from '../lib/router.svelte';
	import { setSessionHint } from '../lib/session';
	import BookmarkGrid from './BookmarkGrid.svelte';

	type Layout = 'masonry' | 'list';
	const pages: Record<string, { view: View; title: string }> = {
		'/dashboard': { view: 'home', title: 'Home' },
		'/dashboard/archive': { view: 'archive', title: 'Archive' },
		'/dashboard/favourites': { view: 'favourites', title: 'Favourites' },
	};
	const page = $derived(pages[route.path] ?? pages['/dashboard']);

	let input = $state('');
	let query = $state(''); // debounced copy of `input` that drives the grid
	let searchEl: HTMLInputElement;
	let timer: ReturnType<typeof setTimeout>;
	let dark = $state(document.documentElement.classList.contains('dark'));
	let layout = $state<Layout>(read('layout') === 'list' ? 'list' : 'masonry');

	function read(key: string) {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	}
	function write(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {}
	}

	// Search on Enter or after a 300 ms pause, never per keystroke (each search scans D1).
	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(() => (query = input.trim()), 300);
	}
	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			clearTimeout(timer);
			query = input.trim();
		} else if (e.key === 'Escape') clearSearch();
	}
	function clearSearch() {
		clearTimeout(timer);
		input = query = '';
	}

	function onWindowKey(e: KeyboardEvent) {
		const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]');
		if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
			e.preventDefault();
			searchEl.focus();
		}
	}

	function go(path: string) {
		clearSearch();
		navigate(path);
	}

	function toggleTheme() {
		dark = !dark;
		document.documentElement.classList.toggle('dark', dark);
		write('theme', dark ? 'dark' : 'light');
	}

	function toggleLayout() {
		layout = layout === 'masonry' ? 'list' : 'masonry';
		write('layout', layout);
	}

	async function logout() {
		await api.logout();
		setSessionHint(false);
		navigate('/');
	}

	const nav = [
		{ path: '/dashboard', label: 'Home', icon: House },
		{ path: '/dashboard/archive', label: 'Archive', icon: Archive },
	];
	const isMac = navigator.platform.toLowerCase().includes('mac');
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet navLink(path: string, label: string, Icon: typeof House | null, emoji?: string)}
	<a
		href={path}
		onclick={(e) => (e.preventDefault(), go(path))}
		class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors {route.path === path && !query
			? 'bg-muted font-medium text-foreground'
			: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
	>
		{#if Icon}<Icon class="size-4" />{:else}<span class="w-4 text-center">{emoji}</span>{/if}
		{label}
	</a>
{/snippet}

<div class="flex min-h-dvh">
	<aside class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4 md:flex">
		<a href="/dashboard" onclick={(e) => (e.preventDefault(), go('/dashboard'))} class="mb-6 flex items-center gap-2 px-2.5">
			<img src="/favicon.svg" alt="" class="size-7" />
			<span class="text-lg font-bold tracking-tight">zerostash</span>
		</a>
		<nav class="grid gap-0.5">
			{#each nav as item (item.path)}{@render navLink(item.path, item.label, item.icon)}{/each}
		</nav>
		<div class="mx-2.5 my-4 border-t"></div>
		<p class="mb-1 px-2.5 text-xs font-semibold text-muted-foreground">Lists</p>
		<nav class="grid gap-0.5">
			{@render navLink('/dashboard/favourites', 'Favourites', null, '⭐')}
		</nav>

		<div class="mt-auto grid gap-0.5 text-sm">
			<a
				href="https://github.com/jammutkarsh/zerostash#connect-the-extension"
				target="_blank"
				rel="noopener"
				class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				<Puzzle class="size-4" />Browser extension
			</a>
			<a href="/openapi.json" target="_blank" class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
				<Braces class="size-4" />API
			</a>
			<p class="mt-3 px-2.5 text-xs text-muted-foreground">Zerostash v{pkg.version}</p>
		</div>
	</aside>

	<div class="min-w-0 flex-1">
		<header class="sticky top-0 z-20 flex items-center gap-2 border-b bg-sidebar/90 px-3 py-2.5 backdrop-blur md:px-5">
			<a href="/dashboard" onclick={(e) => (e.preventDefault(), go('/dashboard'))} class="shrink-0 md:hidden" aria-label="Home">
				<img src="/favicon.svg" alt="" class="size-7" />
			</a>
			<label class="relative flex min-w-0 flex-1 items-center">
				<Search class="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
				<input
					bind:this={searchEl}
					bind:value={input}
					{oninput}
					onkeydown={onSearchKey}
					type="search"
					placeholder="Search"
					aria-label="Search bookmarks"
					class="w-full rounded-md border bg-card py-2 pr-16 pl-9 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-accent/60 [&::-webkit-search-cancel-button]:hidden"
				/>
				{#if input}
					<button onclick={clearSearch} aria-label="Clear search" class="absolute right-2 rounded p-1 text-muted-foreground hover:bg-muted"><X class="size-4" /></button>
				{:else}
					<kbd class="pointer-events-none absolute right-2.5 hidden rounded border px-1.5 text-[11px] text-muted-foreground sm:block">{isMac ? '⌘' : 'Ctrl'} K</kbd>
				{/if}
			</label>
			<button onclick={toggleLayout} aria-label={layout === 'masonry' ? 'Switch to list' : 'Switch to grid'} title={layout === 'masonry' ? 'List view' : 'Grid view'} class="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
				{#if layout === 'masonry'}<Rows3 class="size-4" />{:else}<LayoutGrid class="size-4" />{/if}
			</button>
			<button onclick={toggleTheme} aria-label="Toggle theme" title="Toggle theme" class="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
				{#if dark}<Sun class="size-4" />{:else}<Moon class="size-4" />{/if}
			</button>
			<button onclick={logout} aria-label="Sign out" title="Sign out" class="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
				<LogOut class="size-4" />
			</button>
		</header>

		<nav class="flex gap-1 border-b px-3 py-2 md:hidden">
			{#each [...nav, { path: '/dashboard/favourites', label: 'Favourites', icon: null }] as item (item.path)}
				<a
					href={item.path}
					onclick={(e) => (e.preventDefault(), go(item.path))}
					class="rounded-md px-3 py-1.5 text-sm {route.path === item.path && !query ? 'bg-muted font-medium' : 'text-muted-foreground'}">{item.label}</a
				>
			{/each}
		</nav>

		<main class="mx-auto max-w-[1600px] p-3 md:p-6">
			{#if query}
				<h1 class="mb-4 text-sm text-muted-foreground">Results for <span class="font-medium text-foreground">“{query}”</span></h1>
			{/if}
			{#key `${page.view}|${query}`}
				<BookmarkGrid view={page.view} {query} {layout} />
			{/key}
		</main>
	</div>
</div>
