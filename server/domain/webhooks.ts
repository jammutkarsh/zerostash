// Webhooks: POST a small JSON body to your URL when bookmarks change (Karakeep's payload shape).
import type { Webhook, WebhookEvent } from '../../shared/schemas';
import { notFound } from './util';

interface Row {
	id: string;
	url: string;
	events: string;
	token: string | null;
	created_at: number;
}
const toWebhook = (r: Row): Webhook => ({ id: r.id, url: r.url, events: JSON.parse(r.events), hasToken: !!r.token, createdAt: new Date(r.created_at) });

export async function allWebhooks(db: D1Database): Promise<Webhook[]> {
	return (await db.prepare('SELECT * FROM webhooks ORDER BY created_at').all<Row>()).results.map(toWebhook);
}

/** With the token, for delivery. */
export async function webhookRow(db: D1Database, id: string): Promise<{ url: string; token: string | null; events: WebhookEvent[] } | null> {
	const r = await db.prepare('SELECT * FROM webhooks WHERE id = ?').bind(id).first<Row>();
	return r ? { url: r.url, token: r.token, events: JSON.parse(r.events) } : null;
}

export async function createWebhook(db: D1Database, w: { url: string; events: WebhookEvent[]; token?: string }, now = Date.now()): Promise<Webhook> {
	const id = crypto.randomUUID();
	await db.prepare('INSERT INTO webhooks (id, url, events, token, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, w.url, JSON.stringify([...new Set(w.events)]), w.token || null, now).run();
	return toWebhook((await db.prepare('SELECT * FROM webhooks WHERE id = ?').bind(id).first<Row>())!);
}

export async function updateWebhook(db: D1Database, p: { webhookId: string; url?: string; events?: WebhookEvent[]; token?: string | null }): Promise<Webhook> {
	const sets: string[] = [];
	const values: (string | null)[] = [];
	if (p.url !== undefined) sets.push('url = ?'), values.push(p.url);
	if (p.events !== undefined) sets.push('events = ?'), values.push(JSON.stringify([...new Set(p.events)]));
	if (p.token !== undefined) sets.push('token = ?'), values.push(p.token || null);
	if (sets.length) await db.prepare(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?`).bind(...values, p.webhookId).run();
	const row = await db.prepare('SELECT * FROM webhooks WHERE id = ?').bind(p.webhookId).first<Row>();
	if (!row) throw notFound('Webhook');
	return toWebhook(row);
}

export async function deleteWebhook(db: D1Database, id: string): Promise<void> {
	if (!(await db.prepare('DELETE FROM webhooks WHERE id = ?').bind(id).run()).meta.changes) throw notFound('Webhook');
}
