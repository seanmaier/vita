import { expect, test } from '@playwright/test';
import { andSaved, createUser, logIn } from './users.ts';

test('a wrong password is refused with a message', async ({ page }) => {
  const user = createUser();
  await logIn(page, { ...user, password: 'not-the-password' });
  await expect(page.getByText('Invalid username or password.')).toBeVisible();
});

test('the tour opens on the first login only, and the session survives a reload', async ({ page }) => {
  await logIn(page, createUser());
  const tour = page.getByRole('dialog');
  await expect(tour).toBeVisible();
  await andSaved(page, 'tour-seen', () => page.getByRole('button', { name: 'skip tour' }).click());
  await expect(tour).toBeHidden();

  await page.reload();
  await expect(page.getByRole('link', { name: '+ new' })).toBeVisible();
  await expect(tour).toBeHidden();
});

test('the demo runs without an account', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /try the demo/ }).click();
  await expect(page).toHaveURL(/\/demo/);
  await expect(page.getByRole('dialog')).toBeVisible();
});
