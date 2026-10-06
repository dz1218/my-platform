import { expect, test, type Page } from '@playwright/test';

const chenNian = {
  id: 'inheritance-chennian', name: '陈念', age: 24, avatarUrl: '',
  gender: 'FEMALE' as const, city: '上海', background: '喜欢读书，也喜欢听你分享日常。',
};
const otherIdentity = { ...chenNian, id: 'inheritance-other', name: '林晚' };
type State = {
  gender: 'FEMALE' | 'MALE' | null;
  onboardingCompleted: boolean;
  identity: typeof chenNian | null;
  items: (typeof chenNian & { available: boolean })[];
};
type Session = 'female' | 'male' | 'legacy' | 'completed' | 'inherited';

async function login(page: Page, session: Session) {
  await page.context().addCookies([{
    name: 'companion_session', value: `inheritance-test-${session}`,
    domain: '127.0.0.1', path: '/',
  }]);
}

async function mockInheritance(page: Page, session: Session = 'female', authenticated = true) {
  if (authenticated) await login(page, session);
  const state: State = {
    gender: session === 'legacy' ? null : session === 'male' ? 'MALE' : 'FEMALE',
    onboardingCompleted: session === 'completed' || session === 'inherited',
    identity: session === 'inherited' ? chenNian : null,
    items: [{ ...chenNian, available: session === 'female' || session === 'completed' }, { ...otherIdentity, available: false }],
  };
  const claims: unknown[] = [];
  const skipped: unknown[] = [];
  const genders: unknown[] = [];
  let reads = 0;
  let conflict = false;
  let failedClaim: 'before-save' | 'after-save' | null = null;
  await page.route(/\/api\/v1\/identity-inheritance(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      reads++;
      const selectedId = new URL(route.request().url()).searchParams.get('selectedId');
      return route.fulfill({ json: { ...state, items: [], selected: state.items.find(item => item.id === selectedId) ?? null } });
    }
    claims.push(route.request().postDataJSON());
    if (conflict) {
      state.items = state.items.map((item) => ({ ...item, available: false }));
      return route.fulfill({ status: 409, json: { error: { code: 'identity_unavailable', message: '陈念已被其他用户继承，请选择其他身份。' } } });
    }
    if (failedClaim === 'before-save') {
      return route.fulfill({ status: 500, json: { error: { code: 'internal_error', message: '服务暂时不可用，请稍后重试' } } });
    }
    state.identity = chenNian;
    state.onboardingCompleted = true;
    state.items = [];
    await login(page, 'inherited');
    if (failedClaim === 'after-save') {
      return route.fulfill({ status: 500, json: { error: { code: 'internal_error', message: '服务暂时不可用，请稍后重试' } } });
    }
    return route.fulfill({ json: state });
  });
  await page.route('**/api/v1/identity-inheritance/options?*', route => {
    const items = state.items.filter(item => item.gender === state.gender);
    return route.fulfill({ json: { items, total: items.length, availableTotal: items.filter(item => item.available).length, page: 1, pageSize: 24, nextPage: null, occupations: [] } });
  });
  await page.route('**/api/v1/identity-inheritance/skip', async (route) => {
    skipped.push(route.request().postDataJSON());
    state.onboardingCompleted = true;
    await login(page, 'completed');
    return route.fulfill({ json: state });
  });
  await page.route('**/api/v1/identity-inheritance/gender', async (route) => {
    const body = route.request().postDataJSON();
    genders.push(body);
    state.gender = body.gender;
    state.items = [{ ...chenNian, available: body.gender === 'FEMALE' }];
    await login(page, body.gender === 'FEMALE' ? 'female' : 'male');
    return route.fulfill({ json: state });
  });
  await page.route('**/api/v1/discover?*', (route) => route.fulfill({ json: { items: [otherIdentity], total: 1, availableTotal: 1, page: 1, pageSize: 24, nextPage: null, occupations: [] } }));
  await page.route('**/api/v1/matches', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/operator/conversations', (route) => route.fulfill({ json: { items: [] } }));
  return {
    state, claims, skipped, genders, getReads: () => reads,
    conflict: () => { conflict = true; },
    failClaim: (when: 'before-save' | 'after-save') => { failedClaim = when; },
  };
}

test('registration collects gender and opens the identity choice before regular chat', async ({ page }) => {
  await mockInheritance(page, 'female', false);
  await page.goto('/register');
  await page.getByRole('textbox', { name: '昵称' }).fill('继承测试用户');
  await page.getByRole('textbox', { name: '邮箱' }).fill('inheritance-registration@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByLabel('确认密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('combobox', { name: '性别', exact: true }).click();
  await page.getByRole('option', { name: '女', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL('/choose-identity');
  await expect(page.getByRole('heading', { name: '要继承一个 AI 身份吗？' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择陈念', exact: true })).toBeEnabled();
});

test('choosing requires explicit confirmation and then offers both identities', async ({ page }) => {
  const mock = await mockInheritance(page);
  await page.goto('/choose-identity');
  await expect(page.getByRole('button', { name: '选择陈念', exact: true })).toBeEnabled();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 980 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/inheritance-choice-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '选择陈念', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认继承陈念', exact: true })).toBeVisible();
  expect(mock.claims).toEqual([]);
  await page.getByRole('button', { name: '重新选择', exact: true }).click();
  expect(mock.claims).toEqual([]);
  await expect(page.getByRole('button', { name: '确认继承陈念', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '选择陈念', exact: true }).click();
  await page.getByRole('button', { name: '确认继承陈念', exact: true }).click();
  await expect(page.getByRole('heading', { name: '现在，你有两个身份' })).toBeVisible();
  expect(mock.claims).toEqual([{ identityId: chenNian.id }]);
  await expect(page.getByRole('link', { name: '以本账户聊天', exact: true })).toHaveAttribute('href', '/companion');
  await expect(page.getByRole('link', { name: '以陈念的身份回复', exact: true })).toHaveAttribute('href', '/operator');
  await page.getByRole('link', { name: '以本账户聊天', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  await expect(page.getByRole('button', { name: '和林晚打个招呼', exact: true })).toBeVisible();
});

test('skipping preserves the personal account and does not claim an identity', async ({ page }) => {
  const mock = await mockInheritance(page);
  await page.goto('/choose-identity');
  await page.getByRole('button', { name: '暂不继承，以本账户继续', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  await expect(page.getByRole('button', { name: '和林晚打个招呼', exact: true })).toBeVisible();
  expect(mock.skipped).toEqual([{}]);
  expect(mock.claims).toEqual([]);
  await expect(page.locator('a[href="/operator"]')).toHaveCount(0);
});

test('a concurrent claim refreshes availability and prevents claiming the occupied identity again', async ({ page }) => {
  const mock = await mockInheritance(page);
  mock.conflict();
  await page.goto('/choose-identity');
  await page.getByRole('button', { name: '选择陈念', exact: true }).click();
  const readsBeforeClaim = mock.getReads();
  await page.getByRole('button', { name: '确认继承陈念', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('已被其他用户继承');
  await expect.poll(mock.getReads).toBeGreaterThan(readsBeforeClaim);
  await expect(page.getByRole('button', { name: '确认继承陈念', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '选择陈念', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '陈念已被继承', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: '现在，你有两个身份' })).toHaveCount(0);
  expect(mock.claims).toEqual([{ identityId: chenNian.id }]);
});

test('an unsuccessful claim keeps its error after successful list refreshes and never retries the claim automatically', async ({ page }) => {
  const mock = await mockInheritance(page);
  mock.failClaim('before-save');
  await page.clock.install();
  await page.goto('/choose-identity');
  await page.getByRole('button', { name: '选择陈念', exact: true }).click();
  await page.getByRole('button', { name: '确认继承陈念', exact: true }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('服务暂时不可用');
  await expect(page.getByRole('button', { name: '选择陈念', exact: true })).toBeEnabled();
  const readsAfterFailure = mock.getReads();
  await page.clock.runFor(20_000);
  await expect.poll(mock.getReads).toBeGreaterThan(readsAfterFailure);
  await expect(alert).toContainText('服务暂时不可用');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect.poll(mock.getReads).toBeGreaterThan(readsAfterFailure + 1);
  await expect(alert).toContainText('服务暂时不可用');
  await expect(page.getByRole('heading', { name: '现在，你有两个身份' })).toHaveCount(0);
  expect(mock.claims).toEqual([{ identityId: chenNian.id }]);
});

test('a saved claim recovers from a failed response using the authoritative state', async ({ page }) => {
  const mock = await mockInheritance(page);
  mock.failClaim('after-save');
  await page.goto('/choose-identity');
  await page.getByRole('button', { name: '选择陈念', exact: true }).click();
  await page.getByRole('button', { name: '确认继承陈念', exact: true }).click();
  await expect(page.getByRole('heading', { name: '现在，你有两个身份' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '以陈念的身份回复', exact: true })).toBeVisible();
  expect(mock.claims).toEqual([{ identityId: chenNian.id }]);
});

test('a different inherited identity does not erase the original claim failure', async ({ page }) => {
  const mock = await mockInheritance(page);
  mock.failClaim('before-save');
  await page.goto('/choose-identity');
  await page.getByRole('button', { name: '选择陈念', exact: true }).click();
  await page.getByRole('button', { name: '确认继承陈念', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('服务暂时不可用');
  mock.state.identity = otherIdentity;
  mock.state.onboardingCompleted = true;
  mock.state.items = [];
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('link', { name: '以林晚的身份回复', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('服务暂时不可用');
  expect(mock.claims).toEqual([{ identityId: chenNian.id }]);
});

for (const recovery of ['polling', 'manual reload'] as const) {
  test(`a previous claim error disappears when ${recovery} confirms inheritance`, async ({ page }) => {
    const mock = await mockInheritance(page);
    mock.failClaim('before-save');
    await page.clock.install();
    await page.goto('/choose-identity');
    await page.getByRole('button', { name: '选择陈念', exact: true }).click();
    await page.getByRole('button', { name: '确认继承陈念', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('服务暂时不可用');
    mock.state.identity = chenNian;
    mock.state.onboardingCompleted = true;
    mock.state.items = [];
    await login(page, 'inherited');
    if (recovery === 'polling') await page.clock.runFor(20_000);
    else await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.getByRole('heading', { name: '现在，你有两个身份' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '以本账户聊天', exact: true })).toBeVisible();
    expect(mock.claims).toEqual([{ identityId: chenNian.id }]);
  });
}

test('reloading clears a gender save error only after the saved gender is confirmed', async ({ page }) => {
  const mock = await mockInheritance(page, 'legacy');
  let saves = 0;
  await page.route('**/api/v1/identity-inheritance/gender', route => {
    saves++;
    return route.fulfill({ status: 500, json: { error: { message: '服务暂时不可用，请稍后重试' } } });
  });
  await page.goto('/choose-identity');
  await page.getByRole('combobox', { name: '性别', exact: true }).click();
  await page.getByRole('option', { name: '女', exact: true }).click();
  await page.getByRole('button', { name: '保存性别，查看身份', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('服务暂时不可用');
  mock.state.gender = 'FEMALE';
  mock.state.items = [{ ...chenNian, available: true }];
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择陈念', exact: true })).toBeEnabled();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(saves).toBe(1);
});

test('reloading clears a skip error only after onboarding completion is confirmed', async ({ page }) => {
  const mock = await mockInheritance(page);
  let skips = 0;
  await page.route('**/api/v1/identity-inheritance/skip', route => {
    skips++;
    return route.fulfill({ status: 500, json: { error: { message: '服务暂时不可用，请稍后重试' } } });
  });
  await page.goto('/choose-identity');
  await page.getByRole('button', { name: '暂不继承，以本账户继续', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('服务暂时不可用');
  mock.state.onboardingCompleted = true;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '暂不继承，以本账户继续', exact: true })).toBeEnabled();
  expect(skips).toBe(1);
  expect(mock.claims).toEqual([]);
});

test('male account has no female inheritance options and can continue without inheriting', async ({ page }) => {
  const mock = await mockInheritance(page, 'male');
  await page.goto('/choose-identity');
  await expect(page.getByRole('heading', { name: '要继承一个 AI 身份吗？' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^选择/ })).toHaveCount(0);
  await page.getByRole('button', { name: '暂不继承，以本账户继续', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  expect(mock.claims).toEqual([]);
});

test('an existing account sets gender before seeing matching inheritance choices', async ({ page }) => {
  const mock = await mockInheritance(page, 'legacy');
  await page.goto('/choose-identity');
  await expect(page.getByRole('button', { name: /^选择/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: '性别', exact: true }).click();
  await page.getByRole('option', { name: '女', exact: true }).click();
  await page.getByRole('button', { name: '保存性别，查看身份', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择陈念', exact: true })).toBeEnabled();
  expect(mock.genders).toEqual([{ gender: 'FEMALE' }]);
  expect(mock.claims).toEqual([]);
});

test('an inherited account keeps both identities after reload and can switch to identity replies', async ({ page }) => {
  const mock = await mockInheritance(page, 'inherited');
  await page.goto('/choose-identity');
  await expect(page.getByRole('heading', { name: '现在，你有两个身份' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^选择/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('link', { name: '以本账户聊天', exact: true })).toHaveAttribute('href', '/companion');
  await page.getByRole('link', { name: '以陈念的身份回复', exact: true }).click();
  await expect(page).toHaveURL('/operator');
  await expect(page.locator('main')).toContainText('陈念');
  expect(mock.claims).toEqual([]);
});

test('an inherited account cannot mount a chat with its own AI identity from an old match', async ({ page }) => {
  await mockInheritance(page, 'inherited');
  const conversationRequests: string[] = [];
  let sockets = 0;
  await page.route('**/api/v1/matches/inherited-self', (route) => route.fulfill({ json: {
    id: 'inherited-self', conversationId: 'old-self-conversation', identity: chenNian,
  } }));
  await page.route('**/api/v1/conversations/old-self-conversation/**', (route) => {
    conversationRequests.push(route.request().url());
    return route.fulfill({ json: { items: [] } });
  });
  await page.routeWebSocket('**/ws/conversations/*', (socket) => { sockets++; socket.close(); });
  await page.goto('/chat/inherited-self');
  await expect(page.getByRole('heading', { name: '这是你继承的 AI 身份', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('log')).toHaveCount(0);
  await expect(page.locator('summary')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: '以陈念的身份回复', exact: true })).toHaveAttribute('href', '/operator');
  await expect(page.getByRole('main').getByRole('link', { name: '以本账户聊天', exact: true })).toHaveAttribute('href', '/companion');
  expect(conversationRequests).toEqual([]);
  expect(sockets).toBe(0);
});

test('same-tab logout and login cannot reuse another account’s cached inherited identity', async ({ page }) => {
  await mockInheritance(page, 'inherited');
  await page.goto('/choose-identity');
  const initialDocument = await page.evaluate(() => performance.timeOrigin);
  await expect(page.getByRole('heading', { name: '现在，你有两个身份' })).toBeVisible();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL('/login');

  let reads = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/v1\/identity-inheritance(?:\?.*)?$/, async (route) => {
    reads++;
    await pending;
    return route.fulfill({ json: {
      gender: 'FEMALE', onboardingCompleted: true, identity: null,
      items: [{ ...chenNian, available: false }, { ...otherIdentity, available: true }],
    } });
  });
  await page.route('**/api/v1/identity-inheritance/options?*', route => route.fulfill({ json: {
    items: [{ ...chenNian, available: false }, { ...otherIdentity, available: true }], total: 2, availableTotal: 1, page: 1, pageSize: 24, nextPage: null, occupations: [],
  } }));
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('inheritance-second@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  await page.getByRole('link', { name: '选择 AI 身份', exact: true }).click();
  await expect(page).toHaveURL('/choose-identity');
  try {
    await expect.poll(() => reads).toBe(1);
    await expect(page.getByRole('main').getByRole('status')).toContainText('正在查看可以继承的身份');
    await expect(page.getByRole('heading', { name: '现在，你有两个身份' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '以陈念的身份回复', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(initialDocument);
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: '选择林晚', exact: true })).toBeEnabled();
  await expect(page.getByRole('main')).toContainText('第二测试用户');
  await expect(page.getByRole('button', { name: '陈念已被继承', exact: true })).toBeDisabled();
});

test('an unavailable inheritance feature stops polling and recovers after manual reload', async ({ page }) => {
  await login(page, 'female');
  await page.clock.install();
  let reads = 0;
  let ready = false;
  await page.route(/\/api\/v1\/identity-inheritance(?:\?.*)?$/, route => {
    reads++;
    if (!ready) return route.fulfill({ status: 404, contentType: 'text/plain', body: '404 page not found' });
    return route.fulfill({ json: {
      gender: 'FEMALE', onboardingCompleted: false, identity: null,
      items: [{ ...chenNian, available: true }],
    } });
  });
  await page.route('**/api/v1/identity-inheritance/options?*', route => route.fulfill({ json: {
    items: [{ ...chenNian, available: true }], total: 1, availableTotal: 1, page: 1, pageSize: 24, nextPage: null, occupations: [],
  } }));
  await page.goto('/choose-identity');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('身份选择功能暂未就绪，请稍后刷新');
  await expect(page.getByRole('main')).not.toContainText('暂时连接不上');
  await page.clock.runFor(60_000);
  expect(reads).toBe(1);

  ready = true;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择陈念', exact: true })).toBeEnabled();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(reads).toBe(2);
});
