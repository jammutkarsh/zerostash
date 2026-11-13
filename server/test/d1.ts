// Test-only D1 stand-in over bun:sqlite (D1 is SQLite): enough of the D1 API for the domain
// code — prepare/bind/first/all/run, batch as one transaction — with the real migrations
// applied and foreign keys on, as D1 has them.
import { Database, type Statement } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Value = string | number | null;

class Prepared {
	params: Value[] = [];
	constructor(
		private db: Database,
		readonly sql: string,
	) {}
	bind(...params: unknown[]) {
		const p = new Prepared(this.db, this.sql);
		p.params = params.map((v) => (typeof v === 'boolean' ? Number(v) : (v as Value)));
		return p;
	}
	private stmt(): Statement {
		return this.db.query(this.sql);
	}
	async first<T>(col?: string): Promise<T | null> {
		const row = (this.stmt().get(...this.params) as Record<string, unknown> | null) ?? null;
		return (row && col ? row[col] : row) as T | null;
	}
	async all<T>() {
		return { results: this.stmt().all(...this.params) as T[], meta: { changes: 0 }, success: true };
	}
	async run() {
		const res = this.stmt().run(...this.params);
		return { results: [], meta: { changes: res.changes }, success: true };
	}
	/** Inside batch: rows for reads, changes for writes. */
	exec() {
		const stmt = this.stmt();
		if (stmt.columnNames.length) return { results: stmt.all(...this.params), meta: { changes: 0 }, success: true };
		return { results: [], meta: { changes: stmt.run(...this.params).changes }, success: true };
	}
}

export function testDb(): D1Database {
	const db = new Database(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	const dir = join(import.meta.dir, '../../migrations');
	for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
	return {
		prepare: (sql: string) => new Prepared(db, sql),
		batch: async (stmts: Prepared[]) => db.transaction(() => stmts.map((s) => s.exec()))(),
		exec: async (sql: string) => {
			db.exec(sql);
			return { count: 0, duration: 0 };
		},
	} as unknown as D1Database;
}
