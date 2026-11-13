// Rules (Karakeep's rule engine): when <event> happens to a bookmark and <condition> holds, run
// <actions>. Evaluated in a queue job after the event; actions don't fire further events, so a
// rule can never trigger itself (or another rule) in a loop.
import { fold } from '../../shared/query';
import type { Bookmark, Rule, RuleAction, RuleCondition, RuleEvent } from '../../shared/schemas';
import { updateBookmark } from './bookmarks';
import { addToList, removeFromList } from './lists';
import { updateTags } from './tags';
import { notFound } from './util';

interface Row {
	id: string;
	name: string;
	description: string | null;
	enabled: number;
	event: string;
	condition: string;
	actions: string;
}
const toRule = (r: Row): Rule => ({
	id: r.id,
	name: r.name,
	description: r.description,
	enabled: r.enabled === 1,
	event: JSON.parse(r.event),
	condition: JSON.parse(r.condition),
	actions: JSON.parse(r.actions),
});

export async function allRules(db: D1Database, enabledOnly = false): Promise<Rule[]> {
	return (await db.prepare(`SELECT * FROM rules ${enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY created_at`).all<Row>()).results.map(toRule);
}

type RuleInput = Omit<Rule, 'id' | 'description'> & { description?: string | null };

export async function createRule(db: D1Database, r: RuleInput, now = Date.now()): Promise<Rule> {
	const id = crypto.randomUUID();
	await db
		.prepare('INSERT INTO rules (id, name, description, enabled, event, condition, actions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(id, r.name, r.description || null, r.enabled ? 1 : 0, JSON.stringify(r.event), JSON.stringify(r.condition), JSON.stringify(r.actions), now)
		.run();
	return (await allRules(db)).find((x) => x.id === id)!;
}

export async function updateRule(db: D1Database, r: RuleInput & { id: string }): Promise<Rule> {
	const res = await db
		.prepare('UPDATE rules SET name = ?, description = ?, enabled = ?, event = ?, condition = ?, actions = ? WHERE id = ?')
		.bind(r.name, r.description || null, r.enabled ? 1 : 0, JSON.stringify(r.event), JSON.stringify(r.condition), JSON.stringify(r.actions), r.id)
		.run();
	if (!res.meta.changes) throw notFound('Rule');
	return (await allRules(db)).find((x) => x.id === r.id)!;
}

export async function deleteRule(db: D1Database, id: string): Promise<void> {
	if (!(await db.prepare('DELETE FROM rules WHERE id = ?').bind(id).run()).meta.changes) throw notFound('Rule');
}

export function eventMatches(want: RuleEvent, got: RuleEvent): boolean {
	if (want.type !== got.type) return false;
	if ('tagId' in want) return want.tagId === (got as { tagId: string }).tagId;
	if ('listId' in want) return want.listId === (got as { listId: string }).listId;
	return true;
}

export function conditionHolds(c: RuleCondition, b: Bookmark): boolean {
	const url = b.content.type === 'link' ? b.content.url : (b.content.sourceUrl ?? '');
	const title = [b.title, b.content.type === 'link' ? b.content.title : b.content.type === 'asset' ? b.content.fileName : null].filter(Boolean).join('\n');
	switch (c.type) {
		case 'alwaysTrue':
			return true;
		case 'isFavourited':
			return b.favourited;
		case 'isArchived':
			return b.archived;
		case 'urlContains':
			return fold(url).includes(fold(c.str));
		case 'urlDoesNotContain':
			return !fold(url).includes(fold(c.str));
		case 'titleContains':
			return fold(title).includes(fold(c.str));
		case 'titleDoesNotContain':
			return !fold(title).includes(fold(c.str));
		case 'importedFromFeed':
			return b.feedId === c.feedId;
		case 'bookmarkTypeIs':
			return b.content.type === c.bookmarkType;
		case 'bookmarkSourceIs':
			return b.source === c.source;
		case 'hasTag':
			return b.tags.some((t) => t.id === c.tagId);
		case 'and':
			return c.conditions.every((x) => conditionHolds(x, b));
		case 'or':
			return c.conditions.some((x) => conditionHolds(x, b));
	}
}

async function act(db: D1Database, b: Bookmark, a: RuleAction): Promise<void> {
	switch (a.type) {
		case 'addTag':
			return void (await updateTags(db, b.id, [{ tagId: a.tagId, attachedBy: 'human' }], []));
		case 'removeTag':
			return void (await updateTags(db, b.id, [], [{ tagId: a.tagId, attachedBy: 'human' }]));
		case 'addToList':
			return addToList(db, a.listId, b.id);
		case 'removeFromList':
			return removeFromList(db, a.listId, b.id);
		case 'favouriteBookmark':
			return void (await updateBookmark(db, { bookmarkId: b.id, favourited: true }));
		case 'archiveBookmark':
			return void (await updateBookmark(db, { bookmarkId: b.id, archived: true }));
		case 'downloadFullPageArchive':
			return; // no page archives in Zerostash
	}
}

/** Run every enabled rule whose event is among `events` and whose condition holds. Returns the rule ids that ran. */
export async function applyRules(db: D1Database, b: Bookmark, events: RuleEvent[], rules: Rule[]): Promise<string[]> {
	const ran: string[] = [];
	for (const rule of rules) {
		if (!rule.enabled || !events.some((e) => eventMatches(rule.event, e)) || !conditionHolds(rule.condition, b)) continue;
		for (const action of rule.actions) {
			// A rule pointing at a deleted tag or list skips that action; the rest still run.
			await act(db, b, action).catch((err) => console.log(JSON.stringify({ msg: 'rule action failed', rule: rule.id, action, error: String(err) })));
		}
		ran.push(rule.id);
	}
	return ran;
}
