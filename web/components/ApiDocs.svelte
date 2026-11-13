<script lang="ts">
	import { onMount } from 'svelte';
	import { navigate } from '../lib/router.svelte';

	// Renders /openapi.json with our own code: a third-party docs script on this origin
	// could call the API with the signed-in user's cookie.
	type Schema = {
		$ref?: string;
		description?: string;
		type?: string | string[];
		properties?: Record<string, Schema>;
		required?: string[];
		items?: Schema;
		enum?: unknown[];
		const?: unknown;
		anyOf?: Schema[];
		oneOf?: Schema[];
		allOf?: Schema[];
		nullable?: boolean;
		maxLength?: number;
		default?: unknown;
	};
	type Operation = {
		summary?: string;
		description?: string;
		parameters?: { name: string; in: string; required?: boolean; schema?: Schema }[];
		requestBody?: { content?: Record<string, { schema?: Schema }> };
		responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
		security?: unknown[];
	};
	type Spec = {
		info: { title: string; version: string; description?: string };
		servers?: { url: string }[];
		paths: Record<string, Record<string, Operation>>;
		components?: { schemas?: Record<string, Schema> };
	};

	let spec = $state<Spec | null>(null);
	let error = $state('');
	const origin = location.origin;
	const base = $derived(`${origin}${spec?.servers?.[0]?.url ?? ''}`);

	onMount(async () => {
		try {
			const res = await fetch('/openapi.json');
			if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error('openapi.json is missing; run `bun run build`.');
			spec = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	});

	/** Compact TypeScript-like rendering of a JSON schema. */
	function shape(s: Schema | undefined, indent = ''): string {
		if (!s) return 'unknown';
		if (s.$ref) return s.$ref.split('/').pop()!; // shown under Schemas
		if (s.const !== undefined) return JSON.stringify(s.const);
		if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
		const union = s.anyOf ?? s.oneOf;
		if (union) return union.map((u) => shape(u, indent)).join(' | ');
		if (s.allOf) return s.allOf.map((u) => shape(u, indent)).join(' & ');
		const types = Array.isArray(s.type) ? s.type : [s.type ?? 'object'];
		const base = types.filter((t) => t !== 'null');
		const nullable = types.includes('null') || s.nullable ? ' | null' : '';
		if (base[0] === 'array') return `${shape(s.items, indent)}[]${nullable}`;
		if (base[0] === 'object' && s.properties) {
			const inner = indent + '  ';
			const lines = Object.entries(s.properties).map(([k, v]) => `${inner}${k}${s.required?.includes(k) ? '' : '?'}: ${shape(v, inner)}`);
			return `{\n${lines.join('\n')}\n${indent}}${nullable}`;
		}
		return `${base.join(' | ') || 'unknown'}${nullable}`;
	}

	const methodColour: Record<string, string> = {
		get: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
		post: 'bg-green-500/15 text-green-700 dark:text-green-300',
		put: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
		patch: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
		delete: 'bg-red-500/15 text-red-700 dark:text-red-300',
	};
</script>

<div class="mx-auto max-w-4xl px-5 py-10">
	<a href="/" onclick={(e) => (e.preventDefault(), navigate('/'))} class="mb-8 flex items-center gap-2 font-semibold">
		<img src="/favicon.svg" alt="" class="size-6" />zerostash
	</a>
	{#if error}
		<p class="text-destructive">{error}</p>
	{:else if !spec}
		<p class="text-muted-foreground">Loading…</p>
	{:else}
		<h1 class="text-3xl font-bold">{spec.info.title} <span class="align-middle text-base font-semibold text-muted-foreground">v{spec.info.version}</span></h1>
		<div class="mt-4 grid gap-2 rounded-lg border bg-card p-4 text-sm">
			{#if spec.info.description}<p class="text-muted-foreground">{spec.info.description}</p>{/if}
			<p><span class="font-medium">Base URL:</span> <code class="rounded bg-muted px-1.5 py-0.5">{base}</code></p>
			<p>
				<span class="font-medium">Auth:</span> send your secret as <code class="rounded bg-muted px-1.5 py-0.5">Authorization: Bearer &lt;ZEROSTASH_SECRET&gt;</code>.
				Tools written for Karakeep's API work unchanged: give them this server's address and the secret as the API key.
			</p>
			<p><a href="/openapi.json" class="underline">openapi.json</a> for tools like Postman, Insomnia or code generators.</p>
		</div>
		<pre class="mt-4 overflow-x-auto rounded-lg border bg-card p-4 text-xs">curl {base}/bookmarks \
  -H "Authorization: Bearer $ZEROSTASH_SECRET" \
  -H "Content-Type: application/json" \
  -d '{`{"type": "link", "url": "https://example.com"}`}'</pre>

		<div class="mt-10 grid gap-6">
			{#each Object.entries(spec.paths) as [path, methods] (path)}
				{#each Object.entries(methods) as [method, op] (method)}
					{@const body = op.requestBody?.content?.['application/json']?.schema}
					<section class="rounded-lg border bg-card">
						<header class="flex flex-wrap items-center gap-3 border-b px-4 py-3">
							<span class="rounded px-2 py-0.5 font-mono text-xs font-bold uppercase {methodColour[method] ?? 'bg-muted'}">{method}</span>
							<code class="font-mono text-sm font-medium">{path}</code>
							{#if op.summary}<span class="text-sm text-muted-foreground">{op.summary}</span>{/if}
						</header>
						<div class="grid gap-3 px-4 py-3 text-sm">
							{#if op.description}<p class="text-muted-foreground">{op.description}</p>{/if}
							{#if op.parameters?.length}
								<div>
									<h3 class="mb-1 font-medium">Parameters</h3>
									<ul class="grid gap-1">
										{#each op.parameters as p (p.in + p.name)}
											<li><code class="font-mono">{p.name}</code> <span class="text-muted-foreground">({p.in}{p.required ? ', required' : ''}) · {shape(p.schema)}</span></li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if body}
								<div>
									<h3 class="mb-1 font-medium">Request body</h3>
									<pre class="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{shape(body)}</pre>
								</div>
							{/if}
							<div>
								<h3 class="mb-1 font-medium">Responses</h3>
								{#each Object.entries(op.responses ?? {}) as [status, res] (status)}
									{@const schema = res.content?.['application/json']?.schema}
									<details class="py-0.5">
										<summary class="cursor-pointer"><code class="font-mono font-semibold">{status}</code> <span class="text-muted-foreground">{res.description}</span></summary>
										{#if schema}<pre class="mt-1 overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{shape(schema)}</pre>{/if}
									</details>
								{/each}
							</div>
						</div>
					</section>
				{/each}
			{/each}
		</div>
		{#if spec.components?.schemas}
			<h2 class="mt-12 mb-4 text-xl font-semibold">Schemas</h2>
			<div class="grid gap-4">
				{#each Object.entries(spec.components.schemas) as [name, schema] (name)}
					<section id={name} class="rounded-lg border bg-card px-4 py-3 text-sm">
						<h3 class="font-mono font-semibold">{name}</h3>
						{#if schema.description}<p class="text-muted-foreground">{schema.description}</p>{/if}
						<pre class="mt-2 overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{shape({ ...schema, $ref: undefined })}</pre>
					</section>
				{/each}
			</div>
		{/if}
	{/if}
</div>
