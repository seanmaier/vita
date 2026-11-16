import { Hono } from 'hono';
import type { User } from '../auth.ts';
import { db } from '../db.ts';
import { v1 } from '../v1.ts';

let counter = 0;

/** Inserts a user with a dummy password hash. */
export function createTestUser(name = `user-${++counter}`): User {
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x');
  return { id: Number(result.lastInsertRowid), username: name };
}

/** A Hono app serving /api/v1 as the given user, without server/index.ts's side effects. */
export function testApp(user: User): Hono {
  const app = new Hono<{ Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/v1', v1);
  return app as unknown as Hono;
}
