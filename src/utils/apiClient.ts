// The typed client for the server's routes. Paths, path parameters, body
// fields and response types all come from server/app.ts (AppType), so a route
// that is renamed or answers differently breaks the build here instead of the
// app at runtime. Only types cross over: tsconfig.app.json reads the server's
// declarations, and no server code ends up in the bundle.
import { hc } from 'hono/client';
import type { AppType } from '../../server/app.ts';

export const client = hc<AppType>('/');

/** The server's `{ error }` message for a failed response, or a generic one with the status. */
export async function errorFrom(res: { status: number; json(): Promise<unknown> }, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return new Error(typeof body.error === 'string' ? body.error : `${fallback} (HTTP ${res.status}).`);
}

/** Like errorFrom, but a validation error's `details` (e.g. "too long") make the message when there are any. */
export async function detailedErrorFrom(
  res: { status: number; json(): Promise<unknown> },
  fallback: string,
): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; details?: unknown };
  const details = Array.isArray(body.details) ? body.details.filter((d): d is string => typeof d === 'string') : [];
  if (details.length > 0) return new Error(details.join(' '));
  return new Error(typeof body.error === 'string' ? body.error : `${fallback} (HTTP ${res.status}).`);
}
