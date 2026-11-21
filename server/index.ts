// Starts the server: the app from server/app.ts on PORT, hourly housekeeping,
// and a clean shutdown. Everything that handles requests lives in app.ts.
import { serve } from '@hono/node-server';
import { installCrashHandlers, shutdownHandler } from './lifecycle.ts';
import { log } from './log.ts';

installCrashHandlers();

// Imported only now: loading server/db.ts opens the database and runs the
// migrations, and a failure there must reach the crash handlers above.
const { createApp } = await import('./app.ts');
const { db } = await import('./db.ts');
const { housekeeping } = await import('./housekeeping.ts');

const PORT = Number(process.env.PORT ?? 3000);

housekeeping();
setInterval(housekeeping, 60 * 60 * 1000).unref();

const server = serve({ fetch: createApp().fetch, port: PORT }, (info) => {
  log.info('Listening', {
    url: `http://localhost:${info.port}`,
    // The commit the image was built from (Dockerfile), so a log line can be tied to a deploy.
    version: process.env.APP_VERSION ?? 'dev',
    node: process.version,
    logLevel: process.env.LOG_LEVEL ?? 'info',
  });
});

const shutdown = shutdownHandler(server, () => db.close());
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
