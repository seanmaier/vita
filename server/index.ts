// Starts the server: the app from server/app.ts on PORT, hourly housekeeping,
// and a clean shutdown. Everything that handles requests lives in app.ts.
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { db } from './db.ts';
import { housekeeping } from './housekeeping.ts';
import { log } from './log.ts';

const PORT = Number(process.env.PORT ?? 3000);

housekeeping();
setInterval(housekeeping, 60 * 60 * 1000).unref();

// Errors outside any request leave the process in an unknown state: log them
// in the same format, then exit so Docker's restart policy starts it fresh.
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception, exiting', {}, err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection, exiting', {}, reason);
  process.exit(1);
});

const server = serve({ fetch: createApp().fetch, port: PORT }, (info) => {
  log.info('Listening', { url: `http://localhost:${info.port}`, logLevel: process.env.LOG_LEVEL ?? 'info' });
});

// Node as PID 1 in the container ignores SIGTERM unless it's handled, so
// `docker stop` would wait 10 seconds and kill it. Finish open requests and
// close the database cleanly instead.
function shutdown(signal: string) {
  log.info('Shutting down', { signal });
  setTimeout(() => process.exit(0), 5000).unref();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
