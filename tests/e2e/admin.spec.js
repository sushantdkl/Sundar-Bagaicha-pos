import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.E2E_ADMIN_USER || 'admin';
// No default. A hardcoded PIN silently stops matching the moment the
// deployment's own is changed, and eight tests then fail at the login step and
// read as a regression in whatever they were meant to cover.
const ADMIN_PIN = process.env.E2E_ADMIN_PIN || process.env.ADMIN_PASSWORD || '';

// Sign-in is a staff picker (one button per active user) plus a PIN field —
// there is no username input. Admin lands on the dashboard (PRIMARY_ROUTE);
// the counter is reached from there.
async function loginAsAdmin(page) {
  if (!ADMIN_PIN) {
    throw new Error('Set E2E_ADMIN_PIN (or ADMIN_PASSWORD) to the admin PIN of the target deployment before running the admin suite.');
  }
  await page.goto('/login');
  await page.getByRole('button', { name: ADMIN_USER }).first().click();
  await page.fill('#admin-pin', ADMIN_PIN);
  await page.getByRole('button', { name: /^Sign in$/i }).click();
  await expect(page).toHaveURL(/\/admin\/(dashboard|pos)/, { timeout: 15_000 });
}

async function openCounter(page) {
  await loginAsAdmin(page);
  await page.goto('/admin/pos');
}

test.describe('Single-admin counter POS', () => {
  test('admin can sign in and reach the counter (New Sale)', async ({ page }) => {
    await openCounter(page);
    await expect(page.getByRole('heading', { name: /Point of Sale/i })).toBeVisible();
  });

  test('counter shows the imported menu with prices', async ({ page }) => {
    await openCounter(page);
    await expect(page.getByText('Americano').first()).toBeVisible();
    await expect(page.getByText(/Rs\.?\s?120/).first()).toBeVisible();
  });

  test('variant item is present and offers its serving sizes', async ({ page }) => {
    await openCounter(page);
    // Search narrows the grid. Real Juice is a variant item (Glass 150 / 1 Ltr 400);
    // the counter shows an options affordance rather than a single price, and the
    // price is resolved once a size is picked.
    await page.fill('input[placeholder^="Search menu"]', 'Real Juice');
    const tile = page.getByRole('button', { name: /Real Juice/i }).first();
    await expect(tile).toBeVisible();
    await expect(tile).toContainText(/2 options/i);
  });

  test('key admin pages have no horizontal overflow on mobile', async ({ page }) => {
    await loginAsAdmin(page);
    const routes = [
      '/admin/pos', '/admin/dashboard', '/admin/orders', '/admin/products',
      '/admin/inventory', '/admin/reports', '/admin/general-ledger',
      '/admin/chart-of-accounts', '/admin/expenses', '/admin/settings',
    ];
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(overflow, `horizontal overflow on ${route}`).toBe(false);
    }
  });

  test('wrong password is rejected', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: ADMIN_USER }).first().click();
    await page.fill('#admin-pin', 'definitely-wrong-pw');
    await page.getByRole('button', { name: /^Sign in$/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
