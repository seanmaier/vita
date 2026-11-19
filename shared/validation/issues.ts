// Turns Zod issues into the error messages the app and /api/v1 have always
// returned, so API clients (the Claude skills, the email worker) keep reading
// them the same way. Each schema states only the end of a message ("must be a
// string."); the path is put in front here, in one of two styles:
//
//   quoted   "coverLetter.paragraphs" must be an array of strings.
//   colon    leads[3].url: must start with https://
import { z } from 'zod';

export type IssueStyle = 'quoted' | 'colon';

/** `experience[0].title` from Zod's ['experience', 0, 'title']. */
export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, key) => {
    if (typeof key === 'number') return `${out}[${key}]`;
    return out ? `${out}.${String(key)}` : String(key);
  }, '');
}

/** The issues as messages, each prefixed with its path (and `prefix`, for a value nested in a larger one). */
export function formatIssues(
  issues: readonly z.core.$ZodIssue[],
  style: IssueStyle,
  prefix: readonly PropertyKey[] = [],
): string[] {
  return issues.map((issue) => {
    const path = formatPath([...prefix, ...issue.path]);
    if (!path) return issue.message;
    return style === 'quoted' ? `"${path}" ${issue.message}` : `${path}: ${issue.message}`;
  });
}

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Parses `input`, returning the value or every error found as formatted messages. */
export function check<T>(
  schema: z.ZodType<T>,
  input: unknown,
  style: IssueStyle,
  prefix?: readonly PropertyKey[],
): Checked<T> {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: formatIssues(result.error.issues, style, prefix) };
}

// ---- Building blocks --------------------------------------------------------

const isString = (v: unknown): v is string => typeof v === 'string';

/** A string with something other than whitespace in it; the value itself is kept as given. */
export const nonBlank = (error: string) => z.string({ error }).refine((s) => s.trim() !== '', { error });

/** A string array, reported as one message for the whole field rather than one per bad item. */
export const stringArray = (error: string) =>
  z.custom<string[]>((v) => Array.isArray(v) && v.every(isString), { error });

/** A finite number from 0 to 100. */
export const percent = (error: string) =>
  z.number({ error }).refine((n) => Number.isFinite(n) && n >= 0 && n <= 100, { error });

/** Parses a JSON string, or says why it isn't JSON. */
export function parseJsonText(raw: string): Checked<unknown> {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as SyntaxError).message}`] };
  }
}
