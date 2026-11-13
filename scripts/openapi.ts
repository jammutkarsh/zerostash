// Writes the OpenAPI spec of the REST API (server/rest.ts, Karakeep's /api/v1) as a static
// asset (public/openapi.json, served at /openapi.json), so serving it never costs Worker CPU.
// Runs before `vite dev` and `vite build`.
import { mkdirSync, writeFileSync } from 'node:fs';
import pkg from '../package.json';
import { rest } from '../server/rest';

rest.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
	type: 'http',
	scheme: 'bearer',
	description: 'Your ZEROSTASH_SECRET (Karakeep clients call it the API key). The web app uses its session cookie instead.',
});

const doc = rest.getOpenAPI31Document({
	openapi: '3.1.0',
	info: {
		title: 'Zerostash API',
		version: pkg.version,
		description: `${pkg.description} Compatible with Karakeep's REST API; Karakeep's extension and mobile app use the tRPC API at /api/trpc.`,
	},
	servers: [{ url: '/api/v1' }],
	security: [{ bearer: [] }],
});

mkdirSync('public', { recursive: true });
writeFileSync('public/openapi.json', `${JSON.stringify(doc, null, 2)}\n`);
console.log(`openapi.json: ${Object.keys(doc.paths ?? {}).length} paths`);
