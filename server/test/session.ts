import { createApp } from '../app.ts';
import { hashPassword } from '../auth.ts';
import { db } from '../db.ts';

const app = createApp({ staticDir: './does-not-exist' });
const PASSWORD = 'session test password';
let counter = 0;

/**
 * A new user logged in to the real app, with a `call` that sends requests the
 * way the app's own pages do (session cookie, same-origin header, JSON body).
 */
export async function loggedIn() {
  const username = `session-${++counter}`;
  const userId = Number(
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, await hashPassword(PASSWORD))
      .lastInsertRowid,
  );
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        cookie,
        origin: 'http://localhost',
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  return { app, userId, call };
}
