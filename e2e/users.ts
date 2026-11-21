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
  // A throwaway user per test, with a random password.
  const user = { username: `e2e-${randomUUID().slice(0, 8)}`, password: randomUUID() };
  execFileSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', 'server/cli.ts', 'add', user.username, user.password],
    {
      env: { ...process.env, DB_PATH: process.env.E2E_DB_PATH },
      stdio: 'ignore',
    },
  );
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
 * Skips the tour and waits until the server remembered it, so a reload right
 * away doesn't bring it back.
 */
export async function skipTour(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (res) => res.url().endsWith('/api/settings/tour-seen') && res.request().method() === 'PUT' && res.ok(),
  );
  await page.getByRole('button', { name: 'skip tour' }).click();
  await saved;
}

/** A new user, logged in, with the tour (which opens once per account) closed. */
export async function logInFresh(page: Page): Promise<TestUser> {
  const user = createUser();
  await logIn(page, user);
  await skipTour(page);
  return user;
}
