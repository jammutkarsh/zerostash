// Writes the OpenAPI spec as a static asset (public/openapi.json, served at /openapi.json),
// so serving it never costs Worker CPU. Runs before `vite dev` and `vite build`.
import { mkdirSync, writeFileSync } from 'node:fs';
import pkg from '../package.json';
import { app } from '../server/app';

app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
	type: 'http',
	scheme: 'bearer',
	description: 'Your ZEROSTASH_SECRET. The web UI uses a session cookie from /api/v1/auth/login instead.',
});

const doc = app.getOpenAPI31Document({
	openapi: '3.1.0',
	info: { title: 'Zerostash API', version: pkg.version, description: pkg.description },
	security: [{ bearer: [] }],
});

mkdirSync('public', { recursive: true });
writeFileSync('public/openapi.json', `${JSON.stringify(doc, null, 2)}\n`);
console.log(`openapi.json: ${Object.keys(doc.paths ?? {}).length} paths`);
