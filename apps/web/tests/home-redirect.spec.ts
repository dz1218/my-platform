import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181/__performance';

test.beforeEach(async ({ request }) => {
  await request.post(fixture, { data: { rooms: [], delays: { '/api/v1/me': 500 } } });
});
test.afterEach(async ({ request }) => {
  await request.post(fixture, { data: {} });
});

for (const scenario of [
  { name: 'signed in', session: 'inheritance-test-completed' },
  { name: 'guest', session: '' },
  { name: 'expired session', session: 'expired-session' },
]) {
  test(`home serves the public lobby without redirecting for ${scenario.name}`, async ({ request }) => {
    const response = await request.get('/', {
      maxRedirects: 0,
      headers: scenario.session ? { Cookie: `companion_session=${scenario.session}` } : {},
    });
    expect(response.status()).toBe(200);
    expect(response.headers().location).toBeUndefined();
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['content-type']).toContain('text/html');
    expect(await response.text()).toContain('<title>Radio Friday — 语音直播与陪伴</title>');
  });
}

for (const width of [390, 1440]) {
  test(`reopening home with a saved session renders the lobby directly at ${width}px`, async ({ context, page }, testInfo) => {
    await context.addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
    await page.close();
    const reopened = await context.newPage();
    await reopened.setViewportSize({ width, height: 900 });
    const documents: string[] = [];
    const errors: string[] = [];
    reopened.on('response', response => {
      if (response.request().isNavigationRequest() && response.status() === 200) {
        documents.push(new URL(response.url()).pathname);
      }
    });
    reopened.on('pageerror', error => errors.push(error.message));
    await reopened.goto('/');
    await expect(reopened).toHaveURL('/');
    await expect(reopened.getByText(width < 768 ? '暂无直播间，等一个声音，也可以是你。' : '暂无直播间', { exact: true })).toBeVisible();
    const navigation = reopened.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true });
    await expect(navigation.getByRole('link', { name: '直播', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(reopened.locator('[data-app-startup]')).toHaveCount(0);
    await expect(reopened.locator('.auth-page')).toHaveCount(0);
    expect(documents).toEqual(['/']);
    expect(errors).toEqual([]);
    await reopened.screenshot({ path: testInfo.outputPath(`reopened-home-${width}.png`), fullPage: true });
  });
}
