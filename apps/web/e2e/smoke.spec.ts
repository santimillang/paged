import { expect, test } from '@playwright/test';

test('play the tutorial incident to a win', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Launch day/ }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  await page.getByRole('button', { name: /^Autoscaling/ }).click();
  await page.getByTestId('node-api').click();
  await expect(page.getByText(/Autoscaling scheduled on API/)).toBeVisible();
  await page.getByRole('button', { name: '4x' }).click();
  await expect(page.getByRole('heading', { name: 'Incident resolved' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Interview Moment')).toBeVisible();
});
