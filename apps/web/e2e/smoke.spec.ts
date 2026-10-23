import { expect, test } from '@playwright/test';

test('play the tutorial incident to a win', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Launch day/ }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.getByRole('button', { name: /^Autoscaling/ }).click();
  // Keyboard path: the map must be usable without a mouse.
  await page.getByTestId('node-api').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Autoscaling scheduled on API/)).toBeVisible();
  await page.getByRole('button', { name: '4x' }).click();
  await expect(page.getByText(/Stabilizing: holding SLO \d+s \/ 30s/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Incident resolved' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Interview Moment')).toBeVisible();
});
