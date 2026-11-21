// The user's single documents: edits to a language's default profile (from
// before base profiles), knowledge documents, and account settings.
import type { AppLanguage, Profile } from '#shared/types.ts';
import { db } from '../db.ts';
import { parseStored } from './json.ts';

// ---- Profile overrides ------------------------------------------------------------

export function profileOverride(userId: number, language: AppLanguage): Profile | null {
  return parseStored<Profile>(rawProfileOverride(userId, language));
}

/** The override as stored, for data in the old format (./legacyKeys.ts). */
export function rawProfileOverride(userId: number, language: string): string | null {
  const row = db
    .prepare('SELECT profile FROM profile_overrides WHERE user_id = ? AND language = ?')
    .get(userId, language) as { profile: string } | undefined;
  return row?.profile ?? null;
}

/** Stores an override as it arrived (a backup file or an old database); null removes it. */
export function setRawProfileOverride(userId: number, language: string, raw: string | null): void {
  if (raw === null) {
    db.prepare('DELETE FROM profile_overrides WHERE user_id = ? AND language = ?').run(userId, language);
    return;
  }
  db.prepare(
    `INSERT INTO profile_overrides (user_id, language, profile) VALUES (?, ?, ?)
     ON CONFLICT (user_id, language) DO UPDATE SET profile = excluded.profile`,
  ).run(userId, language, raw);
}

/** Every language with an override. */
export function profileOverrideLanguages(userId: number): string[] {
  const rows = db
    .prepare('SELECT language FROM profile_overrides WHERE user_id = ? ORDER BY language')
    .all(userId) as { language: string }[];
  return rows.map((r) => r.language);
}

// ---- Knowledge documents ----------------------------------------------------------

export function knowledgeDoc(userId: number, doc: string): string | null {
  const row = db.prepare('SELECT content FROM knowledge_docs WHERE user_id = ? AND doc = ?').get(userId, doc) as
    | { content: string }
    | undefined;
  return row?.content ?? null;
}

export function setKnowledgeDoc(userId: number, doc: string, content: string | null): void {
  if (content === null) {
    db.prepare('DELETE FROM knowledge_docs WHERE user_id = ? AND doc = ?').run(userId, doc);
    return;
  }
  db.prepare(
    `INSERT INTO knowledge_docs (user_id, doc, content) VALUES (?, ?, ?)
     ON CONFLICT (user_id, doc) DO UPDATE SET content = excluded.content`,
  ).run(userId, doc, content);
}

// ---- Settings ---------------------------------------------------------------------

export function setting(userId: number, key: string): string | null {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(userId: number, key: string, value: string | null): void {
  if (value === null) {
    db.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').run(userId, key);
    return;
  }
  db.prepare(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`,
  ).run(userId, key, value);
}
