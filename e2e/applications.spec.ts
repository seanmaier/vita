import { expect, test } from '@playwright/test';
import { logInFresh } from './users.ts';

test('a new application is saved on the server and moves through its statuses', async ({ page }) => {
  await logInFresh(page);

  await page.getByRole('link', { name: '+ new' }).click();
  await page.getByRole('button', { name: '🇬🇧 English (default)', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save application' });
  await expect(save).toBeDisabled();
  await page.getByPlaceholder('e.g. Vattenfall').fill('Kaiwerk Studio');
  await page.getByPlaceholder('e.g. Backend Engineer').fill('Fullstack Developer');
  // Opens the application once the server has stored it.
  await save.click();

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

  // Trash and restore go to the server too, and survive a reload.
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByTitle('Move to trash').filter({ visible: true }).click();
  await expect(page.getByText('Kaiwerk Studio').filter({ visible: true })).toHaveCount(0);
  await page.goto('/trash');
  await expect(page.getByText(/Kaiwerk Studio – Fullstack Developer/)).toBeVisible();
  await page.getByRole('button', { name: 'restore' }).click();
  await expect(page.getByText('nothing here.').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Kaiwerk Studio').filter({ visible: true })).toBeVisible();
});
