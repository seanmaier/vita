// How the server process ends: on a crash, and on `docker stop`. Both log in
// the same logfmt format as everything else, so the last lines before a
// restart say why it happened.
import { log } from './log.ts';

/**
 * Errors outside any request leave the process in an unknown state: log them,
 * then exit so Docker's restart policy starts it fresh. Install this before
 * importing server/db.ts, whose migrations run while it loads; a failing one
 * otherwise ends the process with Node's multi-line stack trace instead.
 */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception, exiting', {}, err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection, exiting', {}, reason);
    process.exit(1);
  });
}

/**
 * Node as PID 1 in the container ignores SIGTERM unless it's handled, so
 * `docker stop` would wait 10 seconds and kill it. Finish open requests and
 * clean up instead. A request that never finishes would block that forever,
 * so after `timeoutMs` the process exits with 1 and says so.
 */
export function shutdownHandler(
  server: { close(done: () => void): unknown },
  cleanup: () => void,
  timeoutMs = 5000,
): (signal: string) => void {
  return (signal) => {
    log.info('Shutting down', { signal });
    setTimeout(() => {
      log.warn('Shutdown timed out, forcing exit', { timeoutMs });
      process.exit(1);
    }, timeoutMs).unref();
    server.close(() => {
      cleanup();
      log.info('Stopped');
      process.exit(0);
    });
  };
}
