import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { shutdownHandler } from './lifecycle.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Captures what the logger writes, and stops process.exit from ending the test run. */
function captureProcess() {
  const out: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true));
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  return { out, exit };
}

test('a crash while modules load (e.g. a failing migration) is logged as one logfmt line and exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vita-crash-'));
  const lifecycle = pathToFileURL(join(import.meta.dirname, 'lifecycle.ts')).href;
  writeFileSync(join(dir, 'broken.mjs'), "throw new Error('no such column: role');\n");
  writeFileSync(
    join(dir, 'main.mjs'),
    `import { installCrashHandlers } from '${lifecycle}';\ninstallCrashHandlers();\nawait import('./broken.mjs');\n`,
  );

  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(dir, 'main.mjs')], {
    encoding: 'utf8',
  });

  expect(result.status).toBe(1);
  const lines = result.stderr.trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(
    /^time=\S+ level=ERROR msg="Uncaught exception, exiting" err="Error: no such column: role" stack=/,
  );
});

test('a clean shutdown closes the server, runs the cleanup, logs and exits 0', () => {
  const { out, exit } = captureProcess();
  const cleanup = vi.fn();
  shutdownHandler({ close: (done) => done() }, cleanup)('SIGTERM');

  expect(cleanup).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledWith(0);
  expect(out.join('')).toMatch(/msg="Shutting down" signal=SIGTERM\n.*msg=Stopped\n$/s);
});

test('a shutdown that hangs is logged as a warning and exits 1 after the timeout', () => {
  vi.useFakeTimers();
  const { out, exit } = captureProcess();
  shutdownHandler({ close: () => {} }, vi.fn(), 5000)('SIGTERM');

  vi.advanceTimersByTime(4999);
  expect(exit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(exit).toHaveBeenCalledWith(1);
  expect(out.join('')).toMatch(/level=WARN msg="Shutdown timed out, forcing exit" timeoutMs=5000\n$/);
});
