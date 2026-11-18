import { Hono } from 'hono';
import type { TokenScope, User } from '../auth.ts';
import { db } from '../db.ts';
import type { V1Env } from '../http.ts';
import { v1 } from '../v1.ts';

let counter = 0;

/** Inserts a user with a dummy password hash. */
export function createTestUser(name = `user-${++counter}`): User {
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x');
  return { id: Number(result.lastInsertRowid), username: name };
}

/** /api/v1 as the given user, skipping login and token checks (server/app.test.ts covers those through createApp). */
export function testApp(user: User, options: { scope?: TokenScope } = {}): Hono {
  const app = new Hono<V1Env>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    if (options.scope) c.set('tokenScope', options.scope);
    await next();
  });
  app.route('/api/v1', v1);
  return app as unknown as Hono;
}
