// Unwraps a typed hono/client call: resolves to the success body (typed from the server's
// route contract), or throws ApiError carrying the server's `error` code and message.
import type { ClientResponse } from 'hono/client';
import type { SuccessStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

type AnyResponse = ClientResponse<any, any, any>;
type Ok<R> = R extends ClientResponse<infer T, infer S, infer _F> ? (S extends 204 ? void : S extends SuccessStatusCode ? T : never) : never;

export async function ok<R extends AnyResponse>(call: Promise<R>): Promise<Ok<R>> {
	const res = await call;
	if (res.status === 204) return undefined as Ok<R>;
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new ApiError(res.status, body.error ?? 'error', body.message ?? `Request failed (${res.status})`);
	return body as Ok<R>;
}
