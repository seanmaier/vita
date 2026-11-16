import type { Context } from 'hono';

export type Body = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Body {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function invalid(c: Context, details: string[]) {
  return c.json({ error: 'Validation failed.', details }, 400);
}

/** Reads a JSON object body, or lists what's wrong with it, including fields a typo would silently drop. */
export async function readBody(c: Context, allowed: string[]): Promise<Body | string[]> {
  const body: unknown = await c.req.json().catch(() => undefined);
  if (!isPlainObject(body)) return ['Expected a JSON object body.'];
  const unknownFields = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknownFields.length) return [`Unknown field(s): ${unknownFields.join(', ')}. Allowed: ${allowed.join(', ')}.`];
  return body;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };
