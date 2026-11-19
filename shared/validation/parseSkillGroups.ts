import { z } from 'zod';
import type { SkillGroup } from '#shared/types.ts';
import { nonBlank, parseJsonText } from './issues.ts';

export type SkillGroupsParseResult = { ok: true; skillGroups: SkillGroup[] } | { ok: false; errors: string[] };

const skillGroup = z
  .object(
    {
      label: nonBlank('"label" is required and must be a non-empty string.'),
      skills: z.custom<string[]>((v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string'), {
        error: '"skills" must be a non-empty array of strings.',
      }),
      variant: z.enum(['default', 'learning'], { error: '"variant" must be "default" or "learning".' }).optional(),
    },
    { error: 'expected an object with "label" and "skills".' },
  )
  // "default" is what an unset variant means, so only "learning" is kept.
  .transform(({ label, skills, variant }): SkillGroup => ({
    label,
    skills,
    ...(variant === 'learning' && { variant }),
  }));

const skillGroupsSchema = z.array(skillGroup, { error: 'Expected a JSON array of skill groups.' });

/** Validates a parsed JSON value against SkillGroup[], collecting every error found. */
export function validateSkillGroups(input: unknown): SkillGroupsParseResult {
  const result = skillGroupsSchema.safeParse(input);
  if (result.success) return { ok: true, skillGroups: result.data };
  // This import dialog names items by number ("Item 2: …") rather than by path.
  return {
    ok: false,
    errors: result.error.issues.map((issue) =>
      issue.path.length ? `Item ${String(issue.path[0])}: ${issue.message}` : issue.message,
    ),
  };
}

/** Parses and validates a raw JSON string in one step. */
export function parseSkillGroups(raw: string): SkillGroupsParseResult {
  const json = parseJsonText(raw);
  return json.ok ? validateSkillGroups(json.value) : json;
}
