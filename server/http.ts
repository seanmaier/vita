import type { Context } from 'hono';
import { validator } from 'hono/validator';
import type { TokenScope, User } from './auth.ts';

/** Hono env of the /api/v1 routers. tokenScope is unset for cookie sessions. */
export type V1Env = { Variables: { user: User; tokenScope?: TokenScope; apiToken?: string } };

export type Body = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Body {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function invalid(c: Context, details: string[]) {
  return c.json({ error: 'Validation failed.', details }, 400);
}

/** Checks a JSON body: an object, with no field a typo would silently drop. Returns it or what's wrong. */
export function checkBody(body: unknown, allowed: readonly string[]): Body | string[] {
  if (!isPlainObject(body)) return ['Expected a JSON object body.'];
  const unknownFields = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknownFields.length) return [`Unknown field(s): ${unknownFields.join(', ')}. Allowed: ${allowed.join(', ')}.`];
  return body;
}

/** Reads a JSON object body, or lists what's wrong with it (for routes that check other things first). */
export async function readBody(c: Context, allowed: readonly string[]): Promise<Body | string[]> {
  return checkBody(await c.req.json().catch(() => undefined), allowed);
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

// ---- Body validators ----------------------------------------------------------
// Validator middleware rather than reading the body in the handler: Hono's
// RPC client (src/utils/apiClient.ts) takes each route's body type from it.
// The values stay `unknown`; the handlers check them as before.

const JSON_CONTENT_TYPE = /^application\/([a-z-.]+\+)?json/i;

/**
 * The body Hono's json validator parsed, or, when the request didn't say it
 * is JSON, the body read as JSON anyway (undefined if it isn't): requests
 * without a Content-Type were always accepted, so they still are.
 */
async function sentJson(parsed: unknown, c: Context): Promise<unknown> {
  return JSON_CONTENT_TYPE.test(c.req.header('content-type') ?? '') ? parsed : c.req.json().catch(() => undefined);
}

/** A /api/v1 body: an object with only the `allowed` fields, else a 400 that lists what's wrong. */
export const jsonBody = <const K extends string>(allowed: readonly K[]) =>
  validator('json', async (value, c) => {
    const body = checkBody(await sentJson(value, c), allowed);
    return Array.isArray(body) ? invalid(c, body) : (body as { [P in K]?: unknown });
  });

/** A body read leniently, as the session routes always did: anything but an object reads as `{}`. */
export const jsonFields = <K extends string>() =>
  validator('json', async (value, c) => {
    const body = await sentJson(value, c);
    return (isPlainObject(body) ? body : {}) as { [P in K]?: unknown };
  });

/** Any JSON value, for a handler that checks the whole thing itself (e.g. a backup file). */
export const jsonValue = () => validator('json', (value, c) => sentJson(value, c));
