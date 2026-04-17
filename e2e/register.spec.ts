import { test, expect } from '@playwright/test';

test('التسجيل ثم ظهور الواجهة الرئيسية', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'حساب جديد' }).click();
  const u = `e2e_${Date.now()}`;
  await page.getByTestId('auth-username').fill(u);
  await page.getByTestId('auth-display').fill('E2E User');
  await page.getByTestId('auth-password').fill('e2e_pass_12');
  await page.getByTestId('auth-submit-register').click();
  await expect(page.getByText('Ayman Chat', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'التنقل الرئيسي' })).toBeVisible({ timeout: 15_000 });
});
