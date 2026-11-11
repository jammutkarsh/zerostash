<script lang="ts">
	import { navigate } from '../lib/router.svelte';

	const REPO = 'https://github.com/jammutkarsh/zerostash';
	const DEPLOY = `https://deploy.workers.cloudflare.com/?url=${REPO}`;

	const features: { title: string; body: string; soon?: boolean }[] = [
		{
			title: 'Save in one click',
			body: 'The Chrome and Firefox extension saves the current page with its title, description and image. ⌘⇧E on Mac, Alt+Shift+E elsewhere, or right-click any link.',
		},
		{
			title: 'Previews that actually load',
			body: 'Your browser reads link previews, so redirects, short links and sites that block servers just work. The server only fills in what the extension missed.',
		},
		{
			title: 'Yours, and only yours',
			body: 'Everything lives in a D1 database in your own Cloudflare account. One secret signs you in. No sign-ups, no tracking, and nothing leaves your account unless you turn on an AI provider.',
		},
		{
			title: 'Built to stay free',
			body: "The app is static files, so browsing costs nothing. Every query uses an index, so Cloudflare's free daily allowance goes a very long way.",
		},
		{
			title: 'AI summaries and tags',
			body: 'Bring your own model: Claude, OpenAI, Gemini, OpenRouter or any OpenAI-compatible API such as DeepSeek. Tags reuse the ones you already have.',
			soon: true,
		},
		{
			title: 'Lists, search and imports',
			body: 'Smart lists, a search language, rules, RSS auto-save, and one-step import from Karakeep or your browser bookmarks.',
			soon: true,
		},
	];

	const steps = [
		{ title: 'Deploy', body: 'Click “Deploy to Cloudflare”. It copies the repo to your GitHub and creates the Worker and database.' },
		{ title: 'Set your secret', body: 'Paste a long random string as ZEROSTASH_SECRET. That is your login.' },
		{ title: 'Connect the extension', body: 'Enter your Worker URL and the secret in the extension. Start saving.' },
	];
</script>

<div class="min-h-dvh bg-background">
	<header class="mx-auto flex max-w-6xl items-center gap-6 px-5 py-5">
		<a href="/" class="flex items-center gap-2 text-lg font-semibold">
			<img src="/favicon.svg" alt="" class="size-7" />Zerostash
		</a>
		<nav class="ml-auto flex items-center gap-5 text-sm font-medium text-muted-foreground">
			<a href="#features" class="hidden hover:text-foreground sm:inline">Features</a>
			<a href="#how" class="hidden hover:text-foreground sm:inline">How it works</a>
			<a href={REPO} class="hidden hover:text-foreground sm:inline">GitHub</a>
			<a
				href="/login"
				onclick={(e) => (e.preventDefault(), navigate('/login'))}
				class="rounded-md bg-primary px-3.5 py-2 font-semibold text-primary-foreground">Sign in</a
			>
		</nav>
	</header>

	<main>
		<section class="mx-auto max-w-6xl px-5 pt-14 pb-20">
			<p class="mb-4 inline-block rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
				Open source · MIT · Runs on Cloudflare's free tier
			</p>
			<h1 class="max-w-3xl text-4xl leading-[1.1] font-bold tracking-tight md:text-6xl">
				Your bookmarks, on your own Cloudflare. For <span class="text-accent">₹0</span>.
			</h1>
			<p class="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
				Zerostash is a Karakeep-style bookmark manager that runs entirely on Cloudflare's free tier: a Worker, a D1 database and a
				browser extension. No VPS, no Docker, no monthly bill.
			</p>
			<div class="mt-8 flex flex-wrap items-center gap-3">
				<a href={DEPLOY}><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" class="h-10" /></a>
				<a href={REPO} class="rounded-lg border px-4 py-2.5 text-sm font-semibold hover:bg-muted">View on GitHub</a>
			</div>
		</section>

		<section class="border-y bg-card">
			<div class="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-2">
				<div>
					<h2 class="text-2xl font-semibold">Why it exists</h2>
					<p class="mt-3 leading-relaxed text-muted-foreground">
						Running Karakeep meant renting a server for about ₹600 a month, around the clock, for something I open a few times a
						day. Zerostash keeps the parts I actually use and fits them inside Cloudflare's free allowance.
					</p>
				</div>
				<dl class="grid grid-cols-2 gap-4 text-sm">
					{#each [['100,000', 'requests a day'], ['5 million', 'database reads a day'], ['100,000', 'database writes a day'], ['5 GB', 'of storage']] as [n, label] (label)}
						<div class="rounded-xl border bg-background p-4">
							<dt class="text-2xl font-bold">{n}</dt>
							<dd class="text-muted-foreground">{label}, free</dd>
						</div>
					{/each}
				</dl>
			</div>
		</section>

		<section id="features" class="mx-auto max-w-6xl px-5 py-20">
			<h2 class="text-3xl font-semibold">What you get</h2>
			<div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each features as f (f.title)}
					<article class="rounded-xl border bg-card p-5">
						<h3 class="flex items-center gap-2 font-semibold">
							{f.title}
							{#if f.soon}<span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Coming soon</span>{/if}
						</h3>
						<p class="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
					</article>
				{/each}
			</div>
		</section>

		<section id="how" class="border-t bg-card">
			<div class="mx-auto max-w-6xl px-5 py-20">
				<h2 class="text-3xl font-semibold">Running in three steps</h2>
				<ol class="mt-8 grid gap-4 md:grid-cols-3">
					{#each steps as s, i (s.title)}
						<li class="rounded-xl border bg-background p-5">
							<span class="text-sm font-semibold text-accent">Step {i + 1}</span>
							<h3 class="mt-1 font-semibold">{s.title}</h3>
							<p class="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
						</li>
					{/each}
				</ol>
			</div>
		</section>
	</main>

	<footer class="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-5 py-8 text-sm text-muted-foreground">
		<span>MIT licensed</span>
		<a href={REPO} class="hover:text-foreground">GitHub</a>
		<span>Inspired by <a href="https://karakeep.app" class="underline hover:text-foreground">Karakeep</a></span>
		<span>Made by <a href="https://utkarshchourasia.in" class="underline hover:text-foreground">Utkarsh Chourasia</a></span>
	</footer>
</div>
