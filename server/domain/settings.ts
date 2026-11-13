// User settings in Karakeep's shape, stored as one JSON row of overrides on top of DEFAULTS.
import { z } from 'zod';

const Fields = z.object({
	bookmarkClickAction: z.enum(['open_original_link', 'expand_bookmark_preview']),
	archiveDisplayBehaviour: z.enum(['show', 'hide']),
	timezone: z.string().max(64),
	backupsEnabled: z.boolean(),
	backupsFrequency: z.enum(['daily', 'weekly']),
	backupsRetentionDays: z.number().int().min(1).max(365),
	readerFontSize: z.number().int().min(12).max(24).nullable(),
	readerLineHeight: z.number().min(1.2).max(2.5).nullable(),
	readerFontFamily: z.enum(['serif', 'sans', 'mono']).nullable(),
	autoTaggingEnabled: z.boolean().nullable(),
	autoSummarizationEnabled: z.boolean().nullable(),
	tagStyle: z.enum(['lowercase-hyphens', 'lowercase-spaces', 'lowercase-underscores', 'titlecase-spaces', 'titlecase-hyphens', 'camelCase', 'as-generated']),
	curatedTagIds: z.array(z.string().max(64)).max(500).nullable(),
	inferredTagLang: z.string().max(32).nullable(),
});
export type UserSettings = z.infer<typeof Fields>;
export const UpdateUserSettings = Fields.partial();

const DEFAULTS: UserSettings = {
	bookmarkClickAction: 'open_original_link',
	archiveDisplayBehaviour: 'show',
	timezone: 'UTC',
	backupsEnabled: false,
	backupsFrequency: 'weekly',
	backupsRetentionDays: 30,
	readerFontSize: null,
	readerLineHeight: null,
	readerFontFamily: null,
	autoTaggingEnabled: null,
	autoSummarizationEnabled: null,
	tagStyle: 'as-generated',
	curatedTagIds: null,
	inferredTagLang: null,
};

const KEY = 'user';

async function overrides(db: D1Database): Promise<Partial<UserSettings>> {
	const raw = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(KEY).first<string>('value');
	const parsed = UpdateUserSettings.safeParse(raw ? JSON.parse(raw) : {});
	return parsed.success ? parsed.data : {};
}

export async function getSettings(db: D1Database): Promise<UserSettings> {
	return { ...DEFAULTS, ...(await overrides(db)) };
}

export async function updateSettings(db: D1Database, patch: Partial<UserSettings>): Promise<UserSettings> {
	const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
	const next = { ...(await overrides(db)), ...defined };
	await db
		.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
		.bind(KEY, JSON.stringify(next))
		.run();
	return { ...DEFAULTS, ...next };
}
