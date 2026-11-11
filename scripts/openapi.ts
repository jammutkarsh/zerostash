// Writes the OpenAPI spec as a static asset (dist/client/openapi.json) at build time,
// so serving it never costs Worker CPU. Run after `vite build`.
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

mkdirSync('dist/client', { recursive: true });
writeFileSync('dist/client/openapi.json', JSON.stringify(doc, null, 2));
console.log(`openapi.json: ${Object.keys(doc.paths ?? {}).length} paths`);
