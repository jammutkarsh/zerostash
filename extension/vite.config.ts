import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// One codebase, two targets (PR Pulse pattern): `vite build --mode chrome|firefox`,
// then scripts/generate-manifest.ts writes the per-browser manifest.json.
export default defineConfig(({ mode }) => ({
	root: import.meta.dirname,
	publicDir: false,
	define: { __BROWSER_TARGET__: JSON.stringify(mode === 'firefox' ? 'firefox' : 'chrome') },
	plugins: [svelte({ configFile: false }), tailwindcss()],
	build: {
		emptyOutDir: true,
		target: 'es2022',
		rollupOptions: {
			input: {
				popup: resolve(import.meta.dirname, 'popup/index.html'),
				options: resolve(import.meta.dirname, 'options/index.html'),
				'service-worker': resolve(import.meta.dirname, 'service-worker.ts'),
				bridge: resolve(import.meta.dirname, 'bridge.ts'),
			},
			output: {
				// Fixed names: the manifest and registerContentScripts refer to them.
				entryFileNames: (chunk) => (chunk.name === 'service-worker' || chunk.name === 'bridge' ? '[name].js' : 'assets/[name]-[hash].js'),
				chunkFileNames: 'assets/[name]-[hash].js',
				assetFileNames: 'assets/[name]-[hash][extname]',
			},
		},
	},
}));
