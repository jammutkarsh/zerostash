<script lang="ts">
	import Archive from '@lucide/svelte/icons/archive';
	import Braces from '@lucide/svelte/icons/braces';
	import CircleArrowUp from '@lucide/svelte/icons/circle-arrow-up';
	import Download from '@lucide/svelte/icons/download';
	import House from '@lucide/svelte/icons/house';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import LogOut from '@lucide/svelte/icons/log-out';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import Moon from '@lucide/svelte/icons/moon';
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import Rows3 from '@lucide/svelte/icons/rows-3';
	import Search from '@lucide/svelte/icons/search';
	import Sun from '@lucide/svelte/icons/sun';
	import X from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import pkg from '../../package.json';
	import { api, type View } from '../lib/api';
	import { navigate, route } from '../lib/router.svelte';
	import { setSessionHint } from '../lib/session';
	import { clearCache } from '../lib/store.svelte';
	import { isNewer, latestRelease, UPSTREAM, type Release } from '../lib/update';
	import BookmarkGrid from './BookmarkGrid.svelte';
	import Menu from './Menu.svelte';
	import ShortcutsDialog from './ShortcutsDialog.svelte';

	type Layout = 'masonry' | 'list';
	const pages: Record<string, View> = { '/dashboard': 'home', '/dashboard/archive': 'archive', '/dashboard/favourites': 'favourites' };
	const view = $derived(pages[route.path] ?? 'home');
	const REPO = `https://github.com/${UPSTREAM}`;

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

	let input = $state('');
	let query = $state(''); // debounced copy of `input` that drives the grid
	let searchEl: HTMLInputElement;
	let timer: ReturnType<typeof setTimeout>;
	let dark = $state(document.documentElement.classList.contains('dark'));
	let layout = $state<Layout>(read('layout') === 'list' ? 'list' : 'masonry');
	let collapsed = $state(read('sidebar') === 'collapsed');
	let drawer = $state(false); // mobile
	let shortcuts = $state(false);
	let update = $state<Release | null>(null);

	onMount(async () => {
		const latest = await latestRelease();
		if (latest && isNewer(latest.version, pkg.version)) update = latest;
	});

	// Search on Enter or after a 300 ms pause, never per keystroke (each search scans D1).
	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(() => (query = input.trim()), 300);
	}
	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			clearTimeout(timer);
			query = input.trim();
		} else if (e.key === 'Escape') {
			clearSearch();
			searchEl.blur();
		}
	}
	function clearSearch() {
		clearTimeout(timer);
		input = query = '';
	}

	function onWindowKey(e: KeyboardEvent) {
		const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]');
		// Check "?" first: Shift+/ arrives as "/" with shiftKey on some layouts.
		if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !typing) {
			e.preventDefault();
			shortcuts = !shortcuts;
		} else if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
			e.preventDefault();
			searchEl.focus();
		}
	}

	function go(path: string) {
		clearSearch();
		drawer = false;
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
	function toggleSidebar() {
		collapsed = !collapsed;
		write('sidebar', collapsed ? 'collapsed' : 'open');
	}

	async function logout() {
		await api.logout();
		setSessionHint(false);
		clearCache();
		navigate('/');
	}

	const nav = [
		{ path: '/dashboard', label: 'Home', icon: House },
		{ path: '/dashboard/archive', label: 'Archive', icon: Archive },
	];
	const isMac = navigator.platform.toLowerCase().includes('mac');
	const item = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors';
	const idle = 'text-muted-foreground hover:bg-muted hover:text-foreground';
</script>

<svelte:window onkeydown={onWindowKey} />
<ShortcutsDialog bind:open={shortcuts} />

{#snippet sidebar(mini: boolean)}
	<div class="flex items-center gap-2 {mini ? 'flex-col' : 'px-1'}">
		<a href="/dashboard" onclick={(e) => (e.preventDefault(), go('/dashboard'))} class="flex items-center gap-2 px-1.5" title="Zerostash">
			<img src="/favicon.svg" alt="" class="size-7" />
			{#if !mini}<span class="text-lg font-bold tracking-tight">zerostash</span>{/if}
		</a>
		<button
			onclick={() => (drawer ? (drawer = false) : toggleSidebar())}
			aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'}
			title={mini ? 'Expand sidebar' : 'Collapse sidebar'}
			class="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground {mini ? '' : 'ml-auto'}"
		>
			{#if drawer}<X class="size-4" />{:else if mini}<PanelLeftOpen class="size-4" />{:else}<PanelLeftClose class="size-4" />{/if}
		</button>
	</div>

	<nav class="mt-5 grid gap-0.5">
		{#each nav as n (n.path)}
			<a href={n.path} onclick={(e) => (e.preventDefault(), go(n.path))} title={n.label} class="{item} {mini ? 'justify-center px-0' : ''} {route.path === n.path && !query ? 'bg-muted font-medium text-foreground' : idle}">
				<n.icon class="size-4 shrink-0" />{#if !mini}{n.label}{/if}
			</a>
		{/each}
	</nav>
	<div class="my-4 border-t {mini ? 'mx-1' : 'mx-2.5'}"></div>
	{#if !mini}<p class="mb-1 px-2.5 text-xs font-semibold text-muted-foreground">Lists</p>{/if}
	<a
		href="/dashboard/favourites"
		onclick={(e) => (e.preventDefault(), go('/dashboard/favourites'))}
		title="Favourites"
		class="{item} {mini ? 'justify-center px-0' : ''} {route.path === '/dashboard/favourites' && !query ? 'bg-muted font-medium text-foreground' : idle}"
	>
		<span class="w-4 shrink-0 text-center">⭐</span>{#if !mini}Favourites{/if}
	</a>

	<div class="mt-auto grid gap-0.5">
		{#if update}
			{@const release = update}
			<Menu label="Update available" buttonClass="{item} {mini ? 'justify-center px-0' : ''} bg-accent/15 font-medium text-amber-700 hover:bg-accent/25 dark:text-amber-300" panelClass="left-0 bottom-full mb-2">
				{#snippet trigger()}<CircleArrowUp class="size-4 shrink-0" />{#if !mini}Update available{/if}{/snippet}
				{#snippet children(close)}
					<p class="px-2.5 pt-1.5 pb-2 text-xs whitespace-normal text-muted-foreground">
						Zerostash <b class="text-foreground">v{release.version}</b> is out. This server runs <b class="text-foreground">v{pkg.version}</b>.
					</p>
					<a href={release.url} target="_blank" rel="noopener" onclick={close} role="menuitem" class="{item} {idle}">What's new</a>
					<a href="{REPO}#keep-your-server-up-to-date" target="_blank" rel="noopener" onclick={close} role="menuitem" class="{item} {idle}">How to update</a>
				{/snippet}
			</Menu>
		{/if}
		<Menu label="Resources" buttonClass="{item} {mini ? 'justify-center px-0' : ''} {idle}">
			{#snippet trigger()}<LifeBuoy class="size-4 shrink-0" />{#if !mini}Resources{/if}{/snippet}
			{#snippet children(close)}
				<a href="{REPO}#connect-the-extension" target="_blank" rel="noopener" onclick={close} role="menuitem" class="{item} {idle}">
					<Download class="size-4" />Get the browser extension
				</a>
				<a href="/api-docs" target="_blank" onclick={close} role="menuitem" class="{item} {idle}"><Braces class="size-4" />API documentation</a>
				<button onclick={() => (close(), (shortcuts = true))} role="menuitem" class="{item} {idle}"><Keyboard class="size-4" />Keyboard shortcuts <kbd class="ml-auto rounded border px-1.5 text-[11px]">?</kbd></button>
			{/snippet}
		</Menu>
		<button onclick={toggleTheme} title={dark ? 'Light mode' : 'Dark mode'} class="{item} {mini ? 'justify-center px-0' : ''} {idle}">
			{#if dark}<Sun class="size-4 shrink-0" />{:else}<Moon class="size-4 shrink-0" />{/if}{#if !mini}{dark ? 'Light mode' : 'Dark mode'}{/if}
		</button>
		<button onclick={logout} title="Sign out" class="{item} {mini ? 'justify-center px-0' : ''} {idle}">
			<LogOut class="size-4 shrink-0" />{#if !mini}Sign out{/if}
		</button>
		<p class="mt-2 text-xs text-muted-foreground {mini ? 'text-center' : 'px-2.5'}" title="Zerostash version">
			{#if !mini}<span>Zerostash</span>{/if} <b class="font-bold text-foreground">v{pkg.version}</b>
		</p>
	</div>
{/snippet}

<div class="flex min-h-dvh">
	<aside class="sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar py-4 transition-[width] md:flex {collapsed ? 'w-16 px-2' : 'w-60 px-3'}">
		{@render sidebar(collapsed)}
	</aside>

	{#if drawer}
		<div class="fixed inset-0 z-40 bg-black/40 md:hidden" onclick={() => (drawer = false)} role="presentation"></div>
		<aside class="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-sidebar px-3 py-4 shadow-xl md:hidden">
			{@render sidebar(false)}
		</aside>
	{/if}

	<div class="min-w-0 flex-1">
		<header class="sticky top-0 z-20 flex items-center gap-2 border-b bg-sidebar/90 px-3 py-2.5 backdrop-blur md:px-5">
			<button onclick={() => (drawer = true)} aria-label="Open menu" class="rounded-md p-2 text-muted-foreground hover:bg-muted md:hidden"><MenuIcon class="size-4" /></button>
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
			<button onclick={toggleLayout} aria-label={layout === 'masonry' ? 'List view' : 'Grid view'} title={layout === 'masonry' ? 'List view' : 'Grid view'} class="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
				{#if layout === 'masonry'}<Rows3 class="size-4" />{:else}<LayoutGrid class="size-4" />{/if}
			</button>
		</header>

		<main class="mx-auto max-w-[1600px] p-3 md:p-6">
			{#if query}
				<h1 class="mb-4 text-sm text-muted-foreground">Results for <span class="font-medium text-foreground">“{query}”</span></h1>
			{/if}
			{#key `${view}|${query}`}
				<BookmarkGrid {view} {query} {layout} />
			{/key}
		</main>
	</div>
</div>
