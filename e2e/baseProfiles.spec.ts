import { expect, test } from '@playwright/test';
import { logInFresh } from './users.ts';

test('a base profile is created, renamed, trashed and restored on the server', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await logInFresh(page);
  await page.goto('/profiles');
  await expect(page.getByText('English (default)')).toBeVisible();

  await page.getByRole('button', { name: '+ new base profile' }).click();
  await page.getByPlaceholder('e.g. Backend (EN)').fill('Backend DE');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/profiles\/backend-de$/);

  // The first field of the editor is the base profile's own name.
  await page.getByRole('textbox').first().fill('Backend Deutsch');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saved!' })).toBeVisible();

  // A reload reads the profile back from the server.
  await page.reload();
  await expect(page.getByRole('textbox').first()).toHaveValue('Backend Deutsch');

  await page.goto('/profiles');
  const row = page.locator('div.group').filter({ hasText: 'Backend Deutsch' });
  await row.getByRole('button', { name: 'delete' }).click();
  await expect(row).toBeHidden();
  await page.getByRole('link', { name: 'trash (1)' }).click();
  await page.getByRole('button', { name: 'restore' }).click();
  await page.goto('/profiles');
  await expect(page.getByText('Backend Deutsch')).toBeVisible();
});
