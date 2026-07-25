import { expect, test } from '@playwright/test';

test('public page has Arabic semantics and no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('keyboard user can reach and activate the primary action', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  let found = false;
  for (let index = 0; index < 15; index += 1) {
    const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (focusedText.includes('اختبر مستواك') || focusedText.includes('ابدأ اختبار مستواك')) {
      found = true;
      await page.keyboard.press('Enter');
      break;
    }
    await page.keyboard.press('Tab');
  }
  expect(found).toBe(true);
  await expect(page.getByText(/السؤال 1 من/)).toBeVisible();
});
