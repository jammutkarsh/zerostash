<script lang="ts">
	import ApiDocs from './components/ApiDocs.svelte';
	import Dashboard from './components/Dashboard.svelte';
	import Toasts from './components/Toasts.svelte';
	import Landing from './components/Landing.svelte';
	import Login from './components/Login.svelte';
	import { redirect, route } from './lib/router.svelte';
	import { hasSessionHint } from './lib/session';

	// `/` is the marketing page unless this browser has signed in; `/login` takes the
	// secret; everything under `/dashboard` is the app.
	const page = $derived(
		route.path === '/'
			? hasSessionHint()
				? 'to-dashboard'
				: 'landing'
			: route.path === '/login'
				? 'login'
				: route.path === '/api-docs'
					? 'docs'
				: route.path === '/dashboard' || route.path.startsWith('/dashboard/')
					? 'dashboard'
					: 'unknown',
	);

	$effect(() => {
		if (page === 'to-dashboard') redirect('/dashboard');
		else if (page === 'unknown') redirect('/');
	});
</script>

{#if page === 'landing'}
	<Landing />
{:else if page === 'login'}
	<Login />
{:else if page === 'docs'}
	<ApiDocs />
{:else if page === 'dashboard'}
	<Dashboard />
{/if}
<Toasts />
