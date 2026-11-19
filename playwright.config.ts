import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// A fresh database per run. Set once here; the test workers inherit it, so
// e2e/users.ts creates users in the same database the server reads.
process.env.E2E_DB_PATH ??= join(mkdtempSync(join(tmpdir(), 'vita-e2e-')), 'app.db');

// Runs the built app (npm run test:e2e builds it first) the way production
// does: one Node server for the API and the static frontend.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning server/index.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      DB_PATH: process.env.E2E_DB_PATH,
      STATIC_DIR: './dist',
      COOKIE_SECURE: 'false',
      LOG_LEVEL: 'error',
    },
  },
});
