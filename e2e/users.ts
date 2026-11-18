import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

export interface TestUser {
  username: string;
  password: string;
}

/**
 * Adds a user to the e2e database with the same CLI admins use. Every test
 * gets its own, so tests run in parallel and each starts with no data and the
 * guided tour not yet seen.
 */
export function createUser(): TestUser {
  const user = { username: `e2e-${randomUUID().slice(0, 8)}`, password: 'e2e-password-1234' }; // secret-scan:allow (throwaway e2e user)
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/cli.ts', 'add', user.username, user.password], {
    env: { ...process.env, DB_PATH: process.env.E2E_DB_PATH },
    stdio: 'ignore',
  });
  return user;
}

/** Logs in through the login form. */
export async function logIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'log in' }).click();
}

/**
 * Runs `action` and waits until the server stored the storage key it wrote.
 * The app batches writes and sends them to /api/data shortly after, so a
 * reload right away would lose them (a real browser asks before leaving;
 * Playwright's reload doesn't). Matching the key matters: another batch,
 * e.g. the base profiles seeded on the first login, may be in flight too.
 */
export async function andSaved(page: Page, key: string, action: () => Promise<void>): Promise<void> {
  const saved = page.waitForResponse(
    (res) =>
      res.url().endsWith('/api/data') &&
      res.request().method() === 'PUT' &&
      (res.request().postData() ?? '').includes(`"${key}"`) &&
      res.ok(),
  );
  await action();
  await saved;
}

/** A new user, logged in, with the tour (which opens once per account) closed. */
export async function logInFresh(page: Page): Promise<TestUser> {
  const user = createUser();
  await logIn(page, user);
  await andSaved(page, 'tour-seen', () => page.getByRole('button', { name: 'skip tour' }).click());
  return user;
}
