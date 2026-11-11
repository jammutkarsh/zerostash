<script lang="ts"></script>

<div class="mx-auto grid min-h-dvh max-w-lg content-center gap-4 p-6">
	<h1 class="text-2xl font-semibold">Almost there</h1>
	<p class="text-muted-foreground">
		Zerostash needs a login secret before it can store bookmarks. Generate one and add it to your Worker:
	</p>
	<pre class="overflow-x-auto rounded-lg border bg-card p-4 text-sm">openssl rand -hex 32
npx wrangler secret put ZEROSTASH_SECRET</pre>
	<p class="text-sm text-muted-foreground">
		Or open your Worker in the Cloudflare dashboard → Settings → Variables and Secrets. Reload this page once it's set.
	</p>
</div>
