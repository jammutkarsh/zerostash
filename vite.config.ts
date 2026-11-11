import { cloudflare } from '@cloudflare/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// One `vite dev` runs the SPA (web/) and the Worker (server/) together.
export default defineConfig({
	plugins: [svelte(), tailwindcss(), cloudflare()],
	// Let the Worker answer CORS preflights (extension origins) instead of Vite's dev middleware.
	server: { cors: false },
});
