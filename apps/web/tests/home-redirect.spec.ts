import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181/__performance';

test.beforeEach(async ({ request }) => {
  await request.post(fixture, { data: { delays: { '/api/v1/me': 500 } } });
});
test.afterEach(async ({ request }) => {
  await request.post(fixture, { data: {} });
});

for (const scenario of [
  { name: 'signed in', session: 'inheritance-test-completed', destination: '/companion' },
  { name: 'guest', session: '', destination: '/login' },
  { name: 'expired session', session: 'expired-session', destination: '/login' },
]) {
  test(`home redirects before rendering for ${scenario.name}`, async ({ request }) => {
    const response = await request.get('/', {
      maxRedirects: 0,
      headers: scenario.session ? { Cookie: `companion_session=${scenario.session}` } : {},
    });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe(scenario.destination);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.text()).toBe('');
  });
}

for (const width of [390, 1440]) {
  test(`reopening home with a saved session skips the intermediate document at ${width}px`, async ({ context, page }, testInfo) => {
    await context.addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
    await page.close();
    const reopened = await context.newPage();
    await reopened.setViewportSize({ width, height: 900 });
    await reopened.route('**/api/v1/discover?*', route => route.fulfill({ json: {
      items: [{ id: 'entry-friend', name: '林晚', age: 26, occupation: '设计师', avatarUrl: '' }],
      total: 1, nextPage: null, occupations: [],
    } }));
    await reopened.route('**/api/v1/matches', route => route.fulfill({ json: { items: [] } }));
    const documents: string[] = [];
    const errors: string[] = [];
    reopened.on('response', response => {
      if (response.request().isNavigationRequest() && response.status() === 200) {
        documents.push(new URL(response.url()).pathname);
      }
    });
    reopened.on('pageerror', error => errors.push(error.message));
    await reopened.goto('/');
    await expect(reopened).toHaveURL('/companion');
    await expect(reopened.getByRole('heading', { name: width < 768 ? '陪伴' : '今天想和谁聊聊？', exact: true })).toBeVisible();
    await expect(reopened.locator('[data-app-startup]')).toHaveCount(0);
    await expect(reopened.locator('.auth-page')).toHaveCount(0);
    await expect(reopened.getByRole('button', { name: '和林晚打个招呼' })).toBeVisible();
    expect(documents).toEqual(['/companion']);
    expect(errors).toEqual([]);
    await reopened.screenshot({ path: testInfo.outputPath(`reopened-home-${width}.png`), fullPage: true });
  });
}
