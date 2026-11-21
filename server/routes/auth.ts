// Logging in and out, the current user, and changing one's own password.
// Session cookie only: an API token can't use any of these.
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import {
  checkCredentials,
  clearFailures,
  deleteSession,
  isAdmin,
  isLockedOut,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  recordFailure,
  setPassword,
} from '../auth.ts';
import { jsonFields } from '../http.ts';
import { log, requestFields } from '../log.ts';
import { requireUser, SESSION_COOKIE, startSession } from '../session.ts';

/**
 * Counts a wrong password toward the lockout and logs it with the username
 * tried, so guessing shows up in the log.
 */
function passwordRejected(c: Context, username: string, event: string) {
  recordFailure(username);
  // The username tried, not a logged-in user: on /login there is none yet.
  const fields = { ...requestFields(c), user: username };
  log.warn(event, fields);
  if (isLockedOut(username)) log.warn('Account locked for 15 minutes', fields);
}

export const authRoutes = new Hono()
  .post('/login', jsonFields<'username' | 'password'>(), async (c) => {
    const body = c.req.valid('json');
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) return c.json({ error: 'Username and password are required.' }, 400);
    if (isLockedOut(username)) return c.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);

    const user = await checkCredentials(username, password);
    if (!user) {
      passwordRejected(c, username, 'Login failed');
      return c.json({ error: 'Invalid username or password.' }, 401);
    }

    clearFailures(username);
    startSession(c, user.id);
    log.info('Login', { ...requestFields(c), user: user.username });
    return c.json(user);
  })
  .post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  })
  // `admin` only decides which token scopes the account page offers; the server checks it again.
  .get('/me', requireUser, (c) => c.json({ ...c.get('user'), admin: isAdmin(c.get('user').id) }))
  // A logged-in user changes their own password. The current one is required
  // so a session left open on another device can't be used to take over the
  // account, and wrong guesses count toward the same lockout as logins.
  .post('/password', requireUser, jsonFields<'currentPassword' | 'newPassword'>(), async (c) => {
    const body = c.req.valid('json');
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!currentPassword || !newPassword) return c.json({ error: 'Current and new password are required.' }, 400);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return c.json({ error: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return c.json({ error: `The new password must be at most ${MAX_PASSWORD_LENGTH} characters.` }, 400);
    }

    const { id, username } = c.get('user');
    if (isLockedOut(username)) return c.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
    if (!(await checkCredentials(username, currentPassword))) {
      passwordRejected(c, username, 'Password change rejected');
      // 403, not 401: the session itself is fine, only the password was wrong.
      return c.json({ error: 'The current password is incorrect.' }, 403);
    }

    clearFailures(username);
    // Ends every session, this one included, then logs this device back in so
    // only the other devices are signed out.
    await setPassword(id, newPassword);
    startSession(c, id);
    log.info('Password changed', requestFields(c));
    return c.body(null, 204);
  });
