import { z } from 'zod';
import type { Profile } from '#shared/types.ts';
import { check, nonBlank, parseJsonText, stringArray } from './issues.ts';

export type ParseResult =
  | { ok: true; profile: Profile }
  | { ok: false; errors: string[] };

const string = () => z.string({ error: 'must be a string.' });
const strings = () => stringArray('must be an array of strings.');
/** A list whose items are each checked (and reported) on their own. */
const list = <T extends z.ZodType>(item: T) => z.array(item, { error: 'must be an array.' });
const object = <S extends z.ZodRawShape>(shape: S) => z.object(shape, { error: 'must be an object.' });

const experience = object({
  title: string(),
  company: string(),
  dates: string(),
  companyNote: string().optional(),
  bullets: strings(),
});

const project = object({
  id: string(),
  name: string(),
  stack: string(),
  description: string(),
  link: string().optional(),
  linkLabel: string().optional(),
  hackathonLabel: string().optional(),
});

const education = object({
  degree: string(),
  school: string(),
  dates: string(),
  schoolDetail: string().optional(),
});

const skillGroup = object({
  label: string(),
  skills: strings(),
  variant: z.enum(['default', 'learning'], { error: 'must be "default" or "learning".' }).optional(),
});

const humanLanguage = object({ name: string(), level: string() });

/** A CV profile. Unknown fields are dropped. */
const profileSchema: z.ZodType<Profile> = z
  .object(
    {
      name: nonBlank('is required and must be a non-empty string.'),
      role: string(),
      email: string(),
      website: string(),
      github: string(),
      linkedin: string(),
      city: string(),
      summary: string(),
      experience: list(experience),
      projects: list(project),
      education,
      skillGroups: list(skillGroup),
      languages: list(humanLanguage),
      interests: strings(),
    },
    { error: 'Expected a JSON object.' },
  );

/** Validates a parsed JSON value against the Profile shape, collecting every error found. */
export function validateProfile(input: unknown): ParseResult {
  const result = check(profileSchema, input, 'quoted');
  return result.ok ? { ok: true, profile: result.value } : result;
}

/** Parses and validates a raw JSON string in one step. */
export function parseProfile(raw: string): ParseResult {
  const json = parseJsonText(raw);
  return json.ok ? validateProfile(json.value) : json;
}
