// The whole HTTP app: middleware, every route and the static frontend, without
// starting anything. server/index.ts serves it; tests call it directly, so
// they go through the same login, CSRF and token checks as production.
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import { accessLog, log, requestFields } from './log.ts';
import { applicationRoutes } from './routes/applications.ts';
import { authRoutes } from './routes/auth.ts';
import { baseProfileRoutes } from './routes/baseProfiles.ts';
import { profileOverrideRoutes } from './routes/profileOverrides.ts';
import { dataRoutes } from './routes/data.ts';
import { tokenRoutes } from './routes/tokens.ts';
import { requireUserOrToken } from './session.ts';
import { v1 } from './v1.ts';

export interface AppOptions {
  /** Where the built frontend lives; defaults to STATIC_DIR or ./dist. */
  staticDir?: string;
}

export function createApp({ staticDir = process.env.STATIC_DIR ?? './dist' }: AppOptions = {}) {
  const app = new Hono<{ Variables: RequestIdVariables }>();

  // Registered before the logging middleware, so Docker's health check every
  // 30 seconds doesn't fill the log.
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Every API request gets an ID (or keeps the X-Request-Id the proxy sent),
  // returned in the response header and logged with everything the request
  // triggers. Static files aren't logged.
  app.use('/api/*', requestId());
  app.use('/api/*', accessLog);

  // Anything a handler didn't expect. HTTPExceptions (body too large, CSRF,
  // malformed JSON) are deliberate answers and already show up in the access
  // log by status; on the API they come as JSON like every other error.
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.req.path.startsWith('/api/')
        ? c.json({ error: err.message || 'Request refused.' }, err.status)
        : err.getResponse();
    }
    log.error('Unhandled error', requestFields(c), err);
    const requestId = c.get('requestId');
    return c.req.path.startsWith('/api/')
      ? c.json({ error: 'Internal server error.', requestId }, 500)
      : c.text('Internal Server Error', 500);
  });

  // CSRF only threatens cookie auth. A bearer-token request to /api/v1 can't be
  // forged cross-site: browsers never add an Authorization header on their own,
  // and a page setting one triggers a CORS preflight this server never allows.
  // Without this, body-less script calls (DELETE, POST …/restore) count as
  // text/plain form posts and are refused.
  const csrfCheck = csrf();
  app.use('/api/*', (c, next) =>
    c.req.path.startsWith('/api/v1/') && c.req.header('authorization') !== undefined ? next() : csrfCheck(c, next),
  );
  app.use('/api/*', bodyLimit({ maxSize: 10 * 1024 * 1024 }));

  app.use('/api/v1/*', requireUserOrToken);
  // One chain, so the returned type knows every route (see AppType).
  const api = app
    .route('/api', authRoutes)
    .route('/api/tokens', tokenRoutes)
    .route('/api/applications', applicationRoutes)
    .route('/api/base-profiles', baseProfileRoutes)
    .route('/api/profile-overrides', profileOverrideRoutes)
    .route('/api', dataRoutes)
    .route('/api/v1', v1);

  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  // The frontend is a client-routed SPA: serve real files when they exist,
  // otherwise index.html so deep links like /application/foo still load.
  app.use('/*', serveStatic({ root: staticDir }));
  app.get('/*', serveStatic({ root: staticDir, path: 'index.html' }));

  return api;
}

/** Every API route with its parameters, body fields and responses, for the frontend's typed client. */
export type AppType = ReturnType<typeof createApp>;
