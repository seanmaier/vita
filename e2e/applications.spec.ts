import { expect, test } from '@playwright/test';
import { andSaved, logInFresh } from './users.ts';

test('a new application is saved on the server and moves through its statuses', async ({ page }) => {
  await logInFresh(page);

  await page.getByRole('link', { name: '+ new' }).click();
  await page.getByRole('button', { name: '🇬🇧 English (default)', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save application' });
  await expect(save).toBeDisabled();
  await page.getByPlaceholder('e.g. Vattenfall').fill('Kaiwerk Studio');
  await page.getByPlaceholder('e.g. Backend Engineer').fill('Fullstack Developer');
  await andSaved(page, 'local-apps', () => save.click());

  await expect(page).toHaveURL(/\/application\/kaiwerk-studio/);
  const status = page.getByLabel('Status');
  await expect(status).toHaveValue('drafting');
  await status.selectOption('sent');
  await expect(status).toHaveValue('sent');

  // A reload reads everything back from the server, not from the tab.
  await page.reload();
  await expect(page.getByLabel('Status')).toHaveValue('sent');
  await page.goto('/');
  // The dashboard renders a table and, for small screens, cards; one of them is visible.
  await expect(page.getByText('Kaiwerk Studio').filter({ visible: true })).toBeVisible();
});
