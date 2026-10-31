import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const phone = '13900139009';
const fixture = 'http://127.0.0.1:18181';
async function signIn(context: BrowserContext, password = 'original-password') {
  const response = await context.request.post(`${fixture}/api/v1/auth/login`, { data: { phone, password } });
  expect(response.ok()).toBeTruthy();
}
async function verify(page: Page) {
  await page.getByLabel('手机号', { exact: true }).fill(phone);
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await expect(page.getByRole('button', { name: /s 后重发/ })).toBeDisabled();
  await page.getByLabel('短信验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(page.getByLabel('新密码', { exact: true })).toBeVisible();
}
async function passwords(page: Page, value: string) {
  await page.getByLabel('新密码', { exact: true }).fill(value);
  await page.getByLabel('确认新密码', { exact: true }).fill(value);
}
test.beforeEach(async ({ request }) => {
  await request.post(`${fixture}/__performance`, { data: {} });
  await request.post(`${fixture}/__password/reset`);
});
test.afterEach(async ({ request }) => { await request.post(`${fixture}/__performance`, { data: {} }); });

for (const width of [320, 390, 768, 1440]) {
  test(`password recovery completes and preserves auth layout at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.getByRole('link', { name: '忘记密码', exact: true }).click();
    await expect(page).toHaveURL('/forgot-password');
    await expect(page.locator('.auth-frame')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `/tmp/radio-friday-password/forgot-${width}.png`, fullPage: true });
    await verify(page);
    await passwords(page, 'new-password-123');
    await page.getByLabel('确认新密码', { exact: true }).fill('mismatch');
    await page.getByRole('button', { name: '保存新密码', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('两次输入的密码不一致');
    await page.getByLabel('确认新密码', { exact: true }).fill('new-password-123');
    await page.screenshot({ path: `/tmp/radio-friday-password/reset-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.getByRole('button', { name: '保存新密码', exact: true }).click();
    await expect(page).toHaveURL('/login?password=updated');
    await expect(page.getByRole('status')).toHaveText('密码已更新，请重新登录。');
    expect((await context.cookies()).some(cookie => cookie.name === 'companion_session')).toBeFalsy();
    await page.getByLabel('手机号', { exact: true }).fill(phone);
    await page.getByLabel('密码', { exact: true }).fill('new-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
  });

  test(`change password dialog clears secrets and succeeds at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(context);
    await page.goto('/me');
    const trigger = page.getByRole('button', { name: '修改密码', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '修改密码', exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('新密码', { exact: true })).toHaveAttribute('placeholder', '设置至少 8 位密码');
    await expect(dialog.getByText('8–72 字节；使用字母、数字时为 8–72 位。')).toHaveCount(0);
    await expect(dialog.getByText('修改后所有设备需重新登录，正在进行的直播将结束。')).toHaveCount(0);
    await page.getByLabel('原密码', { exact: true }).fill('draft');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(page.getByLabel('原密码', { exact: true })).toHaveValue('');
    await page.getByLabel('原密码', { exact: true }).fill('wrong');
    await passwords(page, 'changed-password-123');
    await page.getByRole('button', { name: '保存新密码', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('原密码不正确。');
    await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('changed-password-123');
    await page.getByLabel('原密码', { exact: true }).fill('original-password');
    await page.screenshot({ path: `/tmp/radio-friday-password/change-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.getByRole('button', { name: '保存新密码', exact: true }).click();
    await expect(page).toHaveURL('/login?password=updated');
    await expect(page.getByRole('status')).toHaveText('密码已更新，请重新登录。');
    expect((await context.cookies()).some(cookie => cookie.name === 'companion_session')).toBeFalsy();
  });
}

test('password change also logs out a second open browser session', async ({ browser, page, context }) => {
  const other = await browser.newContext();
  try {
    await signIn(context); await signIn(other);
    const second = await other.newPage();
    await page.goto('/me'); await second.goto('http://127.0.0.1:3012/me');
    await expect(second.getByRole('heading', { name: '密码测试账户' })).toBeVisible();
    await page.getByRole('button', { name: '修改密码', exact: true }).click();
    await page.getByLabel('原密码', { exact: true }).fill('original-password');
    await passwords(page, 'changed-password-123');
    await page.getByRole('button', { name: '保存新密码', exact: true }).click();
    await expect(page).toHaveURL('/login?password=updated');
    await expect(second).toHaveURL('http://127.0.0.1:3012/login');
    const oldLogin = await other.request.post(`${fixture}/api/v1/auth/login`, { data: { phone, password: 'original-password' } });
    expect(oldLogin.status()).toBe(401);
    await signIn(other, 'changed-password-123');
  } finally { await other.close(); }
});

test('reset handles invalid code, service failure and returning to phone verification', async ({ page, request }) => {
  await page.goto('/forgot-password');
  await page.getByLabel('手机号', { exact: true }).fill(phone);
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await page.getByLabel('短信验证码', { exact: true }).fill('000000');
  await page.getByRole('button', { name: '验证并继续' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('验证码不正确或已过期');
  await page.getByLabel('短信验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '验证并继续' }).click();
  await passwords(page, 'new-password-123');
  await request.post(`${fixture}/__performance`, { data: { failures: { '/api/v1/auth/password/reset': 503 } } });
  await page.getByRole('button', { name: '保存新密码' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('暂时连接不上');
  await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('new-password-123');
  await page.getByRole('button', { name: '返回修改手机号' }).click();
  await expect(page.getByLabel('手机号', { exact: true })).toHaveValue(phone);
  await expect(page.getByLabel('短信验证码', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('新密码', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '返回登录', exact: true }).click();
  await expect(page).toHaveURL('/login');
});

test('signed-in account can recover by SMS and receives the success destination', async ({ page, context }) => {
  await signIn(context);
  await page.goto('/forgot-password');
  await verify(page);
  await passwords(page, 'recovered-while-signed-in');
  await page.getByRole('button', { name: '保存新密码' }).click();
  await expect(page).toHaveURL('/login?password=updated');
  await expect(page.getByRole('status')).toHaveText('密码已更新，请重新登录。');
});

test('password dialog preserves the draft across breakpoints and clears it when closed', async ({ page, context }) => {
  await signIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/me');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.getByLabel('原密码', { exact: true }).fill('original-password');
  await passwords(page, 'responsive-password');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog', { name: '修改密码' })).toBeVisible();
  await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('responsive-password');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '修改密码', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.getByLabel('原密码', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '忘记原密码？使用短信找回', exact: true }).click();
  await expect(page).toHaveURL('/me');
  await expect(page.getByRole('dialog', { name: '找回密码', exact: true })).toBeVisible();
});


for (const width of [320, 390, 768, 1440]) {
  test(`SMS recovery stays in the password sheet until saved at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(context);
    await page.goto('/me');
    const trigger = page.getByRole('button', { name: '修改密码', exact: true });
    await trigger.click();
    await page.getByLabel('原密码', { exact: true }).fill('discard-this-secret');
    await passwords(page, 'discard-this-draft');
    await page.getByRole('button', { name: '忘记原密码？使用短信找回', exact: true }).click();
    await expect(page).toHaveURL('/me');
    await expect(page.getByRole('dialog', { name: '找回密码', exact: true })).toBeVisible();
    await expect(page.getByLabel('手机号', { exact: true })).toBeFocused();
    await expect(page.getByRole('link', { name: '返回登录', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '使用原密码修改', exact: true }).click();
    await expect(page.getByLabel('原密码', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '忘记原密码？使用短信找回', exact: true }).click();
    await page.screenshot({ path: `/tmp/radio-friday-password/inline-sms-${width}.png`, fullPage: true });
    await verify(page);
    await passwords(page, 'inline-recovered-password');
    await expect(page).toHaveURL('/me');
    await page.screenshot({ path: `/tmp/radio-friday-password/inline-reset-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '保存新密码', exact: true }).click();
    await expect(page).toHaveURL('/login?password=updated');
    await expect(page.getByRole('status')).toHaveText('密码已更新，请重新登录。');
    expect((await context.cookies()).some(cookie => cookie.name === 'companion_session')).toBeFalsy();
    const oldLogin = await context.request.post(`${fixture}/api/v1/auth/login`, { data: { phone, password: 'original-password' } });
    expect(oldLogin.status()).toBe(401);
    await page.getByLabel('手机号', { exact: true }).fill(phone);
    await page.getByLabel('密码', { exact: true }).fill('inline-recovered-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
  });
}
