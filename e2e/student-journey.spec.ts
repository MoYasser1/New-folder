import { expect, test } from '@playwright/test';

test('visitor completes placement and reaches registration', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /حوّل فضولك إلى/ })).toBeVisible();
  await page.getByRole('button', { name: /ابدأ اختبار مستواك مجانًا/ }).first().click();
  for (let index = 0; index < 6; index += 1) {
    await page.locator('.answers button').nth(index === 0 ? 1 : 0).click();
    await page.getByRole('button', { name: index === 5 ? /عرض النتيجة/ : /السؤال التالي/ }).click();
  }
  await expect(page.getByText(/تم تحليل إجاباتك/)).toBeVisible();
  await page.getByRole('button', { name: /احفظ نتيجتك/ }).click();
  await expect(page.getByRole('heading', { name: /لنحفظ تقدمك/ })).toBeVisible();
});

test('demo student signs in and opens the first mission', async ({ page }) => {
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
  await page.getByRole('button', { name: /ابدأ المهمة/ }).click();
  await expect(page.getByText(/كيف يحوّل الكمبيوتر أفكارنا/)).toBeVisible();
});

test('student completes quiz and executes Python code', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('button', { name: 'فتح القائمة' }).isVisible()) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
  }
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('button', { name: /سجّل الدخول/ }).click();
  await page.getByLabel('البريد الإلكتروني').fill('student@yasser-ai.demo');
  await page.getByLabel('كلمة المرور').fill('Demo@2026!');
  await page.getByRole('button', { name: /دخول إلى المختبر/ }).click();
  await page.getByRole('button', { name: /ابدأ المهمة/ }).click();
  await page.locator('.video-frame button').click();
  await page.locator('.lesson-task .answers button').nth(1).click();
  await page.getByRole('button', { name: /انتقل لتحدي الكود/ }).click();
  await page.getByRole('button', { name: /^تشغيل$/ }).click();
  await expect(page.getByText(/أنهيت مهمتك الأولى/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /إكمال المهمة/ })).toBeEnabled();
});

test('new student verifies email before checkout', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('button', { name: 'فتح القائمة' }).isVisible()) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
  }
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByLabel('الاسم الكامل').fill('طالب جديد');
  await page.getByLabel('البريد الإلكتروني').fill(`new-${Date.now()}@example.com`);
  await page.getByLabel('كلمة المرور').fill('Strong@Password2026');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /إنشاء الحساب والمتابعة/ }).click();
  await expect(page.getByRole('heading', { name: /تحقق من بريدك/ })).toBeVisible();
  const otpText = await page.locator('.demo-box').textContent();
  const otp = otpText?.match(/\d{6}/)?.[0];
  expect(otp).toBeTruthy();
  await page.getByLabel('رمز التحقق').fill(otp!);
  await page.getByRole('button', { name: /تأكيد البريد/ }).click();
  await expect(page.getByRole('heading', { name: /أكمل اشتراكك/ })).toBeVisible();
  const checkoutResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/checkout') && response.ok());
  await page.getByRole('button', { name: /دفع تجريبي 799 جنيه/ }).click();
  const orderId = ((await (await checkoutResponse).json()) as { order: { id: string } }).order.id;
  await expect(page.getByRole('heading', { name: /أهلًا بك في المختبر/ })).toBeVisible();
  await page.goto(`/?payment=success&orderId=${orderId}`);
  await expect(page.getByRole('heading', { name: 'تم تفعيل اشتراكك بنجاح' })).toBeVisible();
});

test('parent sees linked student progress from the API', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('button', { name: 'فتح القائمة' }).isVisible()) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
  }
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('button', { name: /سجّل الدخول/ }).click();
  await page.getByLabel('البريد الإلكتروني').fill('parent@yasser-ai.demo');
  await page.getByLabel('كلمة المرور').fill('Demo@2026!');
  await page.getByRole('button', { name: /دخول إلى المختبر/ }).click();
  await expect(page.getByRole('heading', { name: /تقدم .* هذا الأسبوع/ })).toBeVisible();
  await expect(page.getByText('محسوب من الخادم')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /تقدم .* هذا الأسبوع/ })).toBeVisible();
});

test('instructor sees at-risk students and uploads lesson media', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('button', { name: 'فتح القائمة' }).isVisible()) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
  }
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('button', { name: /سجّل الدخول/ }).click();
  await page.getByLabel('البريد الإلكتروني').fill('instructor@yasser-ai.demo');
  await page.getByLabel('كلمة المرور').fill('Demo@2026!');
  await page.getByRole('button', { name: /دخول إلى المختبر/ }).click();
  await expect(page.getByRole('heading', { name: 'طلاب يحتاجون دعمًا' })).toBeVisible();
  const image = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from('browser-upload'),
  ]);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'lesson.png',
    mimeType: 'image/png',
    buffer: image,
  });
  await expect(page.getByText('تم رفع lesson.png بنجاح')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'طلاب يحتاجون دعمًا' })).toBeVisible();
});

test('student opens privacy settings and exports account data', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('button', { name: 'فتح القائمة' }).isVisible()) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
  }
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('button', { name: /سجّل الدخول/ }).click();
  await page.getByLabel('البريد الإلكتروني').fill('student@yasser-ai.demo');
  await page.getByLabel('كلمة المرور').fill('Demo@2026!');
  await page.getByRole('button', { name: /دخول إلى المختبر/ }).click();
  await page.getByRole('button', { name: 'إعدادات الحساب' }).click();
  await expect(page.getByRole('heading', { name: 'الخصوصية والأجهزة' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'الجلسة الحالية' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /تنزيل JSON/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^yasser-ai-account-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText('تم تنزيل نسخة بيانات الحساب.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'الخصوصية والأجهزة' })).toBeVisible();
});

test('student opens the API-backed notification center', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('button', { name: 'فتح القائمة' }).isVisible()) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
  }
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('button', { name: /سجّل الدخول/ }).click();
  await page.getByLabel('البريد الإلكتروني').fill('student@yasser-ai.demo');
  await page.getByLabel('كلمة المرور').fill('Demo@2026!');
  await page.getByRole('button', { name: /دخول إلى المختبر/ }).click();
  await page.getByRole('button', { name: 'عرض الإشعارات' }).click();
  await expect(page.getByRole('heading', { name: 'تنبيهاتك المهمة' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'لا توجد إشعارات جديدة' })).toBeVisible();
});

test('student resets a forgotten password through the complete UI flow', async ({ page, request }) => {
  const email = `forgot-${Date.now()}@example.com`;
  const registration = await request.post('http://localhost:3101/api/auth/register', {
    data: {
      fullName: 'Forgotten Password Student', email,
      password: 'Original@Password2026', acceptedTerms: true,
    },
  });
  expect(registration.status()).toBe(201);
  await page.goto('/');
  if (await page.getByRole('button', { name: 'فتح القائمة' }).isVisible()) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
  }
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByRole('button', { name: /سجّل الدخول/ }).click();
  await page.getByRole('button', { name: 'نسيت كلمة المرور؟' }).click();
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByRole('button', { name: 'إرسال رابط الاسترجاع' }).click();
  await expect(page.getByRole('heading', { name: 'تعيين كلمة المرور' })).toBeVisible();
  await page.getByLabel('كلمة المرور الجديدة').fill('Replacement@Password2026');
  await page.getByLabel('تأكيد كلمة المرور').fill('Replacement@Password2026');
  await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
  await page.getByRole('button', { name: /لديك حساب بالفعل/ }).click();
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill('Replacement@Password2026');
  await page.getByRole('button', { name: /دخول إلى المختبر/ }).click();
  await expect(page.getByRole('heading', { name: 'ابدأ أول مسار لك' })).toBeVisible();
});
