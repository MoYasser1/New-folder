import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const expectNoSeriousViolations = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''));
  expect(blocking, blocking.map((violation) =>
    `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`).join('\n')).toEqual([]);
};

test('public and authentication screens have no serious WCAG violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.getByRole('button', { name: 'اسأل مُرشدك الذكي' }).click();
  await expect(page.getByText('مُرشد المختبر')).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.getByRole('button', { name: 'إغلاق نافذة المرشد' }).click();
  if (await page.getByRole('button', { name: 'فتح القائمة' }).isVisible()) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
  }
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await expect(page.getByLabel('البريد الإلكتروني')).toBeVisible();
  await expectNoSeriousViolations(page);
});

test('student dashboard and lesson have no serious WCAG violations', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('button', { name: 'فتح القائمة' }).isVisible()) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
  }
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('button', { name: /سجّل الدخول/ }).click();
  await page.getByLabel('البريد الإلكتروني').fill('student@yasser-ai.demo');
  await page.getByLabel('كلمة المرور').fill('Demo@2026!');
  await page.getByRole('button', { name: /دخول إلى المختبر/ }).click();
  await expect(page.getByText(/صباح الإنجاز/)).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.getByRole('button', { name: /ابدأ المهمة/ }).click();
  await expect(page.getByText(/كيف يحوّل الكمبيوتر أفكارنا/)).toBeVisible();
  await expectNoSeriousViolations(page);
});
