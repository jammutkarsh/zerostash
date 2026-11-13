// The web app type-imports the tRPC router (server/trpc.ts) for a typed client, which brings
// server code into this DOM program. These stand in for the few Worker globals that code
// names, trimmed to what it uses. tsconfig.worker.json checks the server against the real
// ones (server/worker-configuration.d.ts).
interface D1Result<T = Record<string, unknown>> {
	results: T[];
	meta: { changes: number };
	success: boolean;
}
interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
	run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database {
	prepare(query: string): D1PreparedStatement;
	batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
interface R2ObjectBody {
	body: ReadableStream;
	blob(): Promise<Blob>;
	httpEtag: string;
	writeHttpMetadata(headers: Headers): void;
}
interface R2Bucket {
	put(key: string, value: Blob, options?: { httpMetadata?: Record<string, string> }): Promise<unknown>;
	get(key: string): Promise<R2ObjectBody | null>;
	delete(keys: string | string[]): Promise<void>;
}
interface Env {
	DB: D1Database;
	FILES: R2Bucket;
	JOBS: { send(body: unknown): Promise<void>; sendBatch(messages: { body: unknown }[]): Promise<void> };
	AI: { run(model: string, input: unknown): Promise<unknown>; toMarkdown(file: unknown, options?: unknown): Promise<{ format: string; data: string }> };
	ZEROSTASH_SECRET: string;
	ZEROSTASH_AI?: string;
	ANTHROPIC_API_KEY?: string;
	OPENAI_API_KEY?: string;
	GEMINI_API_KEY?: string;
	AI_API_KEY?: string;
	AI_BASE_URL?: string;
	AI_MODEL?: string;
}
