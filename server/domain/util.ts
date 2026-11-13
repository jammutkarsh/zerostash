// Small helpers shared by the domain modules.

/** A domain rule was broken; the API adapters map `code` to a tRPC code / HTTP status. */
export class DomainError extends Error {
	constructor(
		readonly code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT',
		message: string,
	) {
		super(message);
	}
}

export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found.`);

/** `?, ?, ?` for an IN list. */
export const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** LIKE pattern for "contains", with %, _ and \ escaped (use with ESCAPE '\'). */
export const contains = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const isUniqueViolation = (err: unknown) => /UNIQUE constraint failed/i.test(String(err));
