import { test, expect } from '@playwright/test';

test('محادثة مباشرة بين مستخدمين', async ({ browser }) => {
  const ts = Date.now();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  async function register(page: typeof alice, username: string, displayName: string) {
    await page.goto('/');
    await page.getByRole('button', { name: 'حساب جديد' }).click();
    await page.getByTestId('auth-username').fill(username);
    await page.getByTestId('auth-display').fill(displayName);
    await page.getByTestId('auth-password').fill('e2e_pass_12');
    await page.getByTestId('auth-submit-register').click();
    await expect(page.getByRole('navigation', { name: 'التنقل الرئيسي' })).toBeVisible({
      timeout: 25_000,
    });
  }

  await register(alice, `e2e_al_${ts}`, 'Alice E2E');
  await register(bob, `e2e_bo_${ts}`, 'Bob E2E');

  const bobRowAlice = alice.locator('aside').getByRole('button', { name: /Bob E2E/ }).first();
  await expect(bobRowAlice).toBeVisible({ timeout: 15_000 });
  await bobRowAlice.click();

  await alice.getByPlaceholder('اكتب رسالة').fill('مرحباً من e2e');
  await alice.getByRole('button', { name: 'إرسال' }).click();

  await bob.locator('aside').getByRole('button', { name: /Alice E2E/ }).first().click();
  await expect(bob.locator('section.wa-thread').getByText('مرحباً من e2e')).toBeVisible({
    timeout: 20_000,
  });

  await ctxA.close();
  await ctxB.close();
});
