import { expect, test } from '@playwright/test';

test('duplicate registration error is cleared on refresh', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('textbox', { name: '邮箱' }).fill('already-registered@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByLabel('确认密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('combobox', { name: '性别', exact: true }).click();
  await page.getByRole('option', { name: '女', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '注册', exact: true }).click();

  await expect(page.getByRole('main').getByRole('alert')).toHaveText('该邮箱已被注册，请直接登录。');
  await expect(page).toHaveURL('/register');
  await page.reload();
  await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('login error is cleared on refresh and a subsequent login succeeds', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: '邮箱' }).fill('inheritance-second@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();

  await expect(page.getByRole('main').getByRole('alert')).toHaveText('邮箱或密码不正确，请重新输入。');
  await expect(page).toHaveURL('/login');
  await page.reload();
  await expect(page.getByRole('heading', { name: '登录账号' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

  await page.getByRole('textbox', { name: '邮箱' }).fill('inheritance-second@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/companion');
});

test('old error URLs do not restore stale authentication errors', async ({ page }) => {
  for (const url of ['/register?error=exists', '/login?error=invalid']) {
    await page.goto(url);
    await expect(page.getByRole('button', { name: /^(注册|登录)$/ })).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: /^(注册|登录)$/ })).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  }
});

test('registration dropdown supports keyboard selection, dismissal, and required validation', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('textbox', { name: '邮箱' }).fill('style-check@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByLabel('确认密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('checkbox').check();
  const gender = page.getByRole('combobox', { name: '性别', exact: true });

  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL('/register');
  await expect(gender).toBeFocused();
  await expect(gender).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('form').getByRole('alert')).toHaveText('请选择性别。');

  await gender.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await gender.press('ArrowDown');
  await gender.press('Enter');
  await expect(gender).toHaveText('男');
  await expect(page.locator('form').getByRole('alert')).toHaveCount(0);
  expect(await page.locator('form').evaluate(form => new FormData(form as HTMLFormElement).get('gender'))).toBe('MALE');

  await gender.click();
  await gender.press('Home');
  await gender.press('Escape');
  await expect(gender).toHaveText('男');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await gender.click();
  await page.getByRole('option', { name: '女', exact: true }).click();
  await expect(gender).toHaveText('女');
  await expect(gender).toBeFocused();
  await gender.click();
  await page.getByRole('heading', { name: '创建账号' }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await gender.focus();
  await gender.press('Space');
  await gender.press('Tab');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toBeFocused();
});

test('registration keeps password fields together and styles the open dropdown on mobile and desktop', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/register');
    await expect(page.locator('input[name="password"]')).toBeVisible();
    expect(await page.locator('input[name="password"]').evaluate(input => input.parentElement?.nextElementSibling?.querySelector('input')?.name)).toBe('confirm');
    const gender = page.getByRole('combobox', { name: '性别', exact: true });
    await gender.click();
    const menu = page.getByRole('listbox');
    await expect(menu).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(gender).toHaveCSS('outline-style', 'none');
    const triggerBox = await gender.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(menuBox!.width).toBeCloseTo(triggerBox!.width, 0);
    expect(menuBox!.x).toBeCloseTo(triggerBox!.x, 0);
    expect(menuBox!.y >= triggerBox!.y + triggerBox!.height || menuBox!.y + menuBox!.height <= triggerBox!.y).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/register-select-${width}.png`, fullPage: true });
  }
});
