import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`login remains usable after switching to registration at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/login');
    await page.getByLabel('手机号', { exact: true }).fill('13800138000');
    await page.getByLabel('密码', { exact: true }).fill('wrong-password');
    await page.getByRole('link', { name: '手机号注册', exact: true }).click();
    await expect(page.getByLabel('短信验证码', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '返回登录', exact: true }).click();
    await expect(page.getByLabel('密码', { exact: true })).toBeEnabled();
    await page.getByLabel('手机号', { exact: true }).fill('13800138000');
    await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true })).toBeVisible();
  });

  test(`login settles after registration is clicked during submission at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/login');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    await page.route('**/login', async route => {
      if (route.request().method() === 'POST' && !held) {
        held = true;
        await gate;
      }
      await route.continue();
    });
    try {
      await page.getByLabel('手机号', { exact: true }).fill('13800138000');
      await page.getByLabel('密码', { exact: true }).fill('wrong-password');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByLabel('密码', { exact: true })).toBeDisabled();
      const registration = page.getByRole('link', { name: '手机号注册', exact: true });
      await expect(registration).toHaveAttribute('aria-disabled', 'true');
      // Exercise both pointer and keyboard activation while the request is pending.
      const bounds = await registration.boundingBox();
      await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
      await registration.focus();
      await registration.press('Enter');
      await expect(page).toHaveURL('/login');
      release();
      await expect(page.getByRole('main').getByRole('alert')).toHaveText('手机号或密码不正确，请重新输入。');
      await expect(registration).toHaveAttribute('aria-disabled', 'false');
      await registration.click();
      await expect(page).toHaveURL('/register');
      await page.getByRole('link', { name: '返回登录', exact: true }).click();
      await expect(page.getByLabel('密码', { exact: true })).toBeEnabled();
      await page.getByLabel('手机号', { exact: true }).fill('13800138000');
      await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page).toHaveURL('/');
    } finally {
      release();
    }
  });

  test(`successful login survives a registration navigation during submission at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/login');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/login', async route => {
      if (route.request().method() === 'POST') await gate;
      await route.continue();
    });
    try {
      await page.getByLabel('手机号', { exact: true }).fill('13800138000');
      await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByLabel('密码', { exact: true })).toBeDisabled();
      const registration = page.getByRole('link', { name: '手机号注册', exact: true });
      await expect(registration).toHaveAttribute('aria-disabled', 'true');
      // Exercise both pointer and keyboard activation while the request is pending.
      const bounds = await registration.boundingBox();
      await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
      await registration.focus();
      await registration.press('Enter');
      await expect(page).toHaveURL('/login');
      release();
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });
}
