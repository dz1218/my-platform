import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const livekitUrl = process.env.LIVEKIT_TEST_URL || 'http://127.0.0.1:7880';
const apiKey = process.env.LIVEKIT_TEST_API_KEY || 'devkey';
const apiSecret = process.env.LIVEKIT_TEST_API_SECRET || 'devsecretdevsecretdevsecretdevsec';
type Joined = { role: 'host' | 'viewer'; identity: string; token: string; voiceToken: string; livekitUrl: string };
type WireParticipant = { identity: string; permission: { canPublish?: boolean; can_publish?: boolean; canPublishSources?: (string | number)[]; can_publish_sources?: (string | number)[] }; tracks?: { type: string | number }[] };
type MediaWindow = Window & { voiceMedia: { calls: number; cameraCalls: number; tracks: MediaStreamTrack[]; deny: boolean; hold: boolean; denyCamera: boolean; holdCamera: boolean; release?: () => void; releaseCamera?: () => void } };

async function rpc(method: string, body: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: apiKey, nbf: now, exp: now + 300, video: { roomCreate: true, roomAdmin: true, roomList: true, room: body.room || body.name } })}`;
  const token = `${data}.${createHmac('sha256', apiSecret).update(data).digest('base64url')}`;
  const response = await fetch(`${livekitUrl.replace(/^ws/, 'http')}/twirp/livekit.RoomService/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  expect(response.ok, `${method}: ${response.status}`).toBe(true);
  return response.json();
}

async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3012', permissions: ['microphone', 'camera'] });
  await context.addInitScript(() => {
    const state: MediaWindow['voiceMedia'] = { calls: 0, cameraCalls: 0, tracks: [], deny: false, hold: false, denyCamera: false, holdCamera: false };
    (window as unknown as MediaWindow).voiceMedia = state;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.audio) {
        state.calls++;
        if (state.deny) throw new DOMException('test permission denied', 'NotAllowedError');
      }
      if (constraints?.video) {
        state.cameraCalls++;
        if (state.denyCamera) throw new DOMException('test camera denied', 'NotAllowedError');
      }
      const stream = await original(constraints);
      state.tracks.push(...stream.getTracks());
      if (constraints?.audio && state.hold) await new Promise<void>((resolve) => { state.release = resolve; });
      if (constraints?.video && state.holdCamera) await new Promise<void>((resolve) => { state.releaseCamera = resolve; });
      return stream;
    };
  });
  return { context, page: await context.newPage() };
}

async function join(page: Page, roomId: string): Promise<Joined> {
  const response = page.waitForResponse((r) => r.url().endsWith(`/rooms/${roomId}/join`) && r.request().method() === 'POST');
  await page.goto(`/live/${roomId}`);
  const joined = await (await response).json() as Joined;
  expect(joined.voiceToken).toBeTruthy();
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
  return joined;
}

async function login(context: BrowserContext) {
  await context.addCookies([{ name: 'companion_session', value: 'live-test-host', domain: '127.0.0.1', path: '/' }]);
}

async function directVoice(page: Page, roomId: string, joined: Joined, suffix: string, requestId: string) {
  return page.evaluate(async ({ roomId, joined, suffix, requestId }) => {
    const response = await fetch(`/api/v1/rooms/${roomId}/voice${suffix}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Live-Voice-Token': joined.voiceToken }, body: JSON.stringify({ requestId }),
    });
    return response.status;
  }, { roomId, joined, suffix, requestId });
}

test.describe('single viewer voice with real Go API and LiveKit', () => {
  test.skip(process.env.LIVEKIT_INTEGRATION !== '1', 'Requires local LiveKit');

  test('host and caller share the stage and swap sizes without restarting their cameras', async ({ page: host, context, browser }) => {
    test.setTimeout(90_000);
    const roomId = `voice-e2e-${randomUUID()}`;
    const caller = await guest(browser);
    const viewer = await guest(browser);
    await rpc('CreateRoom', { name: roomId, emptyTimeout: 30, metadata: JSON.stringify({ title: '大小画面测试', ownerId: 'live-test-host' }) });
    const pane = (page: Page, name: '主播画面' | '连麦者画面') => page.getByRole('group', { name, exact: true });
    async function expectMain(page: Page, name: '主播画面' | '连麦者画面') {
      await expect.poll(async () => {
        const main = await pane(page, name).boundingBox();
        const small = await pane(page, name === '主播画面' ? '连麦者画面' : '主播画面').boundingBox();
        return !!main && !!small && main.width > small.width * 1.5 && small.x >= main.x && small.y >= main.y &&
          small.x + small.width <= main.x + main.width && small.y + small.height <= main.y + main.height;
      }).toBe(true);
    }
    try {
      await login(context);
      await join(host, roomId);
      await join(caller.page, roomId);
      await join(viewer.page, roomId);
      await host.getByRole('button', { name: '开启摄像头', exact: true }).click();
      await expect(pane(caller.page, '主播画面').locator('video')).toBeVisible();
      await expect(caller.page.getByRole('button', { name: '切换大小画面', exact: true })).toHaveCount(0);
      await caller.page.getByRole('button', { name: '申请连麦', exact: true }).click();
      await host.getByRole('button', { name: /^连麦/ }).click();
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      for (const page of [host, caller.page, viewer.page]) {
        await expect(pane(page, '连麦者画面')).toContainText('摄像头未开启');
        await expectMain(page, '主播画面');
      }
      await caller.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      for (const page of [host, caller.page, viewer.page]) {
        await expect(page.locator('.live-stage video')).toHaveCount(2);
        await expect.poll(() => pane(page, '连麦者画面').locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
        // Keep the original elements: swapping should only change presentation.
        const videos = await page.locator('.live-stage video').elementHandles();
        await page.getByRole('button', { name: '将连麦者切换到大画面', exact: true }).click();
        await expectMain(page, '连麦者画面');
        await page.getByRole('button', { name: '切换大小画面', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expectMain(page, '主播画面');
        for (const video of videos) expect(await video.evaluate((element: HTMLVideoElement) => element.isConnected && element.readyState >= 2)).toBe(true);
      }
      expect(await caller.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.cameraCalls)).toBe(1);
      await expect(caller.page.getByRole('region', { name: '我的连麦', exact: true }).locator('video')).toHaveCount(0);
      await caller.page.getByRole('button', { name: '全屏观看', exact: true }).click();
      await expect.poll(() => caller.page.evaluate(() => !!document.fullscreenElement?.querySelector('[aria-label="连麦者画面"]'))).toBe(true);
      await caller.page.getByRole('button', { name: '切换大小画面', exact: true }).click();
      await expectMain(caller.page, '连麦者画面');
      await caller.page.getByRole('button', { name: '退出全屏', exact: true }).click();
      await caller.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      await expect(pane(caller.page, '连麦者画面')).toContainText('摄像头未开启');
      await expectMain(caller.page, '连麦者画面');
      await caller.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      for (const width of [390, 1440]) {
        await caller.page.setViewportSize({ width, height: 980 });
        await expectMain(caller.page, '连麦者画面');
        await caller.page.getByRole('button', { name: '将主播切换到大画面', exact: true }).click();
        await expectMain(caller.page, '主播画面');
        expect(await caller.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await caller.page.evaluate(() => window.scrollTo(0, 0));
        await caller.page.screenshot({ path: test.info().outputPath(`stage-caller-${width}.png`), fullPage: true });
        await caller.page.getByRole('button', { name: '切换大小画面', exact: true }).click();
      }
      await host.setViewportSize({ width: 390, height: 980 });
      await host.getByRole('button', { name: '关闭摄像头', exact: true }).click();
      const openCamera = host.getByRole('button', { name: '打开画面', exact: true });
      await expect(openCamera).toBeVisible();
      const openButtonBounds = await openCamera.boundingBox();
      const thumbnailBounds = await pane(host, '连麦者画面').boundingBox();
      expect(openButtonBounds!.y + openButtonBounds!.height).toBeLessThanOrEqual(thumbnailBounds!.y);
      await host.evaluate(() => window.scrollTo(0, 0));
      await host.screenshot({ path: test.info().outputPath('stage-host-camera-off-390.png'), fullPage: true });
      await openCamera.click();
      await expect(pane(viewer.page, '主播画面').locator('video')).toBeVisible();
      await caller.page.getByRole('button', { name: '退出连麦', exact: true }).click();
      for (const page of [host, caller.page, viewer.page]) {
        await expect(pane(page, '连麦者画面')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '切换大小画面', exact: true })).toHaveCount(0);
        await expect(pane(page, '主播画面').locator('video')).toBeVisible();
      }
      await caller.page.getByRole('button', { name: '申请连麦', exact: true }).click();
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      await expectMain(caller.page, '主播画面');
    } finally {
      await caller.context.close();
      await viewer.context.close();
      await rpc('DeleteRoom', { room: roomId });
    }
  });

  test('one request reserves the slot through approval, speaking and mute; everyone hears audio', async ({ page: host, context, browser }) => {
    test.setTimeout(120_000);
    const roomId = `voice-e2e-${randomUUID()}`;
    const one = await guest(browser);
    const two = await guest(browser);
    await rpc('CreateRoom', { name: roomId, emptyTimeout: 30, metadata: JSON.stringify({ title: '连麦测试直播间', ownerId: 'live-test-host' }) });
    try {
      await login(context);
      expect((await join(host, roomId)).role).toBe('host');
      await one.context.addCookies([{ name: 'companion_session', value: 'live-test-viewer', domain: '127.0.0.1', path: '/' }]);
      const first = await join(one.page, roomId);
      expect(first.role).toBe('viewer');
      await expect(host.getByRole('button', { name: '开启摄像头', exact: true })).toBeVisible();
      await expect(host.getByRole('button', { name: '开启麦克风', exact: true })).toBeVisible();
      await expect(one.page.getByRole('button', { name: /^(开启摄像头|开启麦克风|打开画面|呼叫 AI 助手)$/ })).toHaveCount(0);
      await expect(one.page.getByRole('region', { name: '我的连麦', exact: true })).toHaveCount(0);
      await expect(one.page.getByRole('switch')).toHaveCount(0);
      const second = await join(two.page, roomId);
      await expect(host.getByRole('button', { name: '在线 3', exact: true })).toBeVisible();
      await host.getByRole('button', { name: '连麦', exact: true }).click();
      await expect(one.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();
      await one.page.getByRole('button', { name: '申请连麦' }).click();
      await expect(one.page.getByRole('button', { name: '取消申请' })).toBeEnabled();
      await expect(two.page.getByRole('button', { name: '已有观众申请中' })).toBeDisabled();
      expect(await directVoice(two.page, roomId, second, '/request', randomUUID())).toBe(409);
      expect(await one.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.calls)).toBe(0);
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      await expect(one.page.getByRole('switch', { name: '麦克风', exact: true })).toBeEnabled();
      await expect(one.page.getByRole('region', { name: '我的连麦', exact: true })).toBeVisible();
      await expect(one.page.getByRole('switch', { name: '麦克风', exact: true })).not.toBeChecked();
      await expect(one.page.getByRole('switch', { name: '摄像头', exact: true })).not.toBeChecked();
      expect(await one.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.cameraCalls)).toBe(0);
      expect(await one.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.calls)).toBe(0);
      await expect(two.page.getByRole('button', { name: '已有观众连麦中' })).toBeDisabled();
      expect(await directVoice(two.page, roomId, second, '/request', randomUUID())).toBe(409);
      const approved = (await rpc('ListParticipants', { room: roomId })).participants.find((p: WireParticipant) => p.identity === first.identity) as WireParticipant;
      expect(approved.permission.canPublish ?? approved.permission.can_publish).toBe(true);
      expect(approved.permission.canPublishSources ?? approved.permission.can_publish_sources).toEqual(['CAMERA', 'MICROPHONE']);

      await one.page.getByRole('switch', { name: '麦克风', exact: true }).click();
      await expect(one.page.getByRole('switch', { name: '麦克风', exact: true })).toBeChecked();
      for (const listener of [host, two.page]) {
        await expect(listener.locator('audio')).toHaveCount(1);
        const play = listener.getByRole('button', { name: '播放声音', exact: true });
        if (await play.isVisible()) await play.click();
        await expect.poll(() => listener.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
        await expect.poll(() => listener.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
      }
      await one.page.getByRole('switch', { name: '麦克风', exact: true }).click();
      await expect(one.page.getByRole('switch', { name: '麦克风', exact: true })).not.toBeChecked();
      await expect.poll(() => one.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.tracks.every((track) => track.readyState === 'ended'))).toBe(true);
      expect(await directVoice(two.page, roomId, second, '/request', randomUUID())).toBe(409);
      await one.page.getByRole('switch', { name: '麦克风', exact: true }).click();
      await expect(host.locator('audio')).toHaveCount(1);

      await one.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      await expect(one.page.getByRole('switch', { name: '摄像头', exact: true })).toBeChecked();
      await expect(one.page.getByRole('group', { name: '连麦者画面', exact: true }).locator('video')).toHaveCount(1);
      await expect(one.page.getByRole('region', { name: '我的连麦' }).locator('video')).toHaveCount(0);
      for (const listener of [host, two.page]) {
        await expect(listener.locator('video')).toHaveCount(1);
        await expect.poll(() => listener.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
      }
      await one.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      await expect(host.locator('video')).toHaveCount(0);
      await expect(one.page.getByRole('switch', { name: '麦克风', exact: true })).toBeChecked();
      await expect(host.locator('audio')).toHaveCount(1);
      await one.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      await expect(one.page.getByRole('switch', { name: '摄像头', exact: true })).toBeChecked();

      for (const width of [390, 1440]) {
        await expect(host.getByRole('button', { name: '在线 3', exact: true })).toBeVisible();
        await host.setViewportSize({ width, height: 980 });
        await one.page.setViewportSize({ width, height: 980 });
        for (const p of [host, one.page]) {
          expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          await p.evaluate(() => window.scrollTo(0, 0));
        }
        await host.screenshot({ path: test.info().outputPath(`voice-host-${width}.png`), fullPage: true });
        await one.page.screenshot({ path: test.info().outputPath(`voice-viewer-${width}.png`), fullPage: true });
      }
      await host.getByRole('button', { name: '结束连麦', exact: true }).click();
      await expect(one.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();
      await expect(host.locator('audio')).toHaveCount(0);
      await expect(two.page.locator('audio')).toHaveCount(0);
      await expect(host.locator('video')).toHaveCount(0);
      await expect(two.page.locator('video')).toHaveCount(0);
      await expect(one.page.getByRole('region', { name: '我的连麦', exact: true })).toHaveCount(0);
      await expect(one.page.getByRole('switch')).toHaveCount(0);
      await expect.poll(() => one.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.tracks.every((track) => track.readyState === 'ended'))).toBe(true);

      await two.page.getByRole('button', { name: '申请连麦' }).click();
      await host.getByRole('button', { name: '拒绝申请' }).click();
      await expect(two.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();
      await two.page.getByRole('button', { name: '申请连麦' }).click();
      await two.page.getByRole('button', { name: '取消申请' }).click();
      await expect(one.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();
      await two.page.getByRole('button', { name: '申请连麦' }).click();
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      await two.page.getByRole('button', { name: '退出连麦', exact: true }).click();
      await expect(one.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();

      // Exercise the actual LiveKit publish checks from a browser SDK participant,
      // using a credential and approval issued by the real application handlers.
      const probe = await one.context.newPage();
      await probe.goto('/live');
      await probe.addScriptTag({ path: resolve('node_modules/livekit-client/dist/livekit-client.umd.js') });
      const probeJoined = await probe.evaluate(async (roomId) => {
        const sdk = (window as unknown as { LivekitClient: typeof import('livekit-client') }).LivekitClient;
        const joined = await (await fetch(`/api/v1/rooms/${roomId}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '权限验证观众' }) })).json();
        const room = new sdk.Room();
        (window as unknown as { voiceProbeRoom: import('livekit-client').Room }).voiceProbeRoom = room;
        await room.connect(joined.livekitUrl, joined.token);
        return joined as Joined;
      }, roomId);
      expect(await directVoice(probe, roomId, probeJoined, '/request', randomUUID())).toBe(200);
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      await expect.poll(() => probe.evaluate(() => (window as unknown as { voiceProbeRoom: import('livekit-client').Room }).voiceProbeRoom.localParticipant.permissions?.canPublish)).toBe(true);
      const rejected = await probe.evaluate(async () => {
        const sdk = (window as unknown as { LivekitClient: typeof import('livekit-client') }).LivekitClient;
        const room = (window as unknown as { voiceProbeRoom: import('livekit-client').Room }).voiceProbeRoom;
        const results: boolean[] = [];
        for (const source of [sdk.Track.Source.Camera, sdk.Track.Source.ScreenShare]) {
          const track = await sdk.createLocalVideoTrack();
          try { await room.localParticipant.publishTrack(track, { source }); results.push(false); }
          catch { results.push(true); }
          finally { await room.localParticipant.unpublishTrack(track, true); track.stop(); }
        }
        await room.disconnect();
        return results;
      });
      expect(rejected).toEqual([false, true]);
      await expect(one.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();
    } finally {
      await one.context.close();
      await two.context.close();
      await rpc('DeleteRoom', { room: roomId });
    }
  });

  test('denied or delayed microphone consent cannot reopen a call; host departure releases approval', async ({ page: host, context, browser }) => {
    test.setTimeout(90_000);
    const roomId = `voice-e2e-${randomUUID()}`;
    const viewer = await guest(browser);
    await rpc('CreateRoom', { name: roomId, emptyTimeout: 30, metadata: JSON.stringify({ title: '连麦测试直播间', ownerId: 'live-test-host' }) });
    try {
      await login(context);
      await join(host, roomId);
      await join(viewer.page, roomId);
      await host.getByRole('button', { name: '连麦', exact: true }).click();
      await viewer.page.getByRole('button', { name: '申请连麦' }).click();
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      await viewer.page.evaluate(() => { (window as unknown as MediaWindow).voiceMedia.deny = true; });
      await viewer.page.getByRole('switch', { name: '麦克风', exact: true }).click();
      await expect(viewer.page.getByRole('main').getByRole('alert')).toContainText('未获得麦克风权限');
      await viewer.page.evaluate(() => { (window as unknown as MediaWindow).voiceMedia.deny = false; (window as unknown as MediaWindow).voiceMedia.hold = true; });
      await viewer.page.getByRole('switch', { name: '麦克风', exact: true }).click();
      await expect.poll(() => viewer.page.evaluate(() => !!(window as unknown as MediaWindow).voiceMedia.release)).toBe(true);
      await host.getByRole('button', { name: '结束连麦', exact: true }).click();
      await expect(viewer.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();
      await viewer.page.evaluate(() => { (window as unknown as MediaWindow).voiceMedia.hold = false; (window as unknown as MediaWindow).voiceMedia.release?.(); });
      await expect.poll(() => viewer.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.tracks.every((track) => track.readyState === 'ended'))).toBe(true);
      await expect(host.locator('audio')).toHaveCount(0);
      await viewer.page.getByRole('button', { name: '申请连麦' }).click();
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      await viewer.page.getByRole('switch', { name: '麦克风', exact: true }).click();
      await expect(host.locator('audio')).toHaveCount(1);
      await host.getByRole('button', { name: '离开房间', exact: true }).click();
      await expect(viewer.page.getByRole('button', { name: '申请连麦' })).toBeDisabled({ timeout: 15_000 });
      await expect.poll(() => viewer.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.tracks.every((track) => track.readyState === 'ended'))).toBe(true);
      const people = (await rpc('ListParticipants', { room: roomId })).participants as WireParticipant[];
      expect(people.every((p) => !(p.permission.canPublish ?? p.permission.can_publish))).toBe(true);
    } finally {
      await viewer.context.close();
      await rpc('DeleteRoom', { room: roomId });
    }
  });

  test('camera consent can be retried and delayed consent cannot share video after hanging up', async ({ page: host, context, browser }) => {
    test.setTimeout(60_000);
    const roomId = `voice-e2e-${randomUUID()}`;
    const viewer = await guest(browser);
    await rpc('CreateRoom', { name: roomId, emptyTimeout: 30, metadata: JSON.stringify({ title: '连麦测试直播间', ownerId: 'live-test-host' }) });
    try {
      await login(context);
      await join(host, roomId);
      await join(viewer.page, roomId);
      await host.getByRole('button', { name: '连麦', exact: true }).click();
      await viewer.page.getByRole('button', { name: '申请连麦' }).click();
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      await viewer.page.evaluate(() => { (window as unknown as MediaWindow).voiceMedia.denyCamera = true; });
      await viewer.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      await expect(viewer.page.getByRole('main').getByRole('alert')).toContainText('未获得摄像头权限');
      await expect(viewer.page.getByRole('switch', { name: '摄像头', exact: true })).not.toBeChecked();
      await viewer.page.evaluate(() => { (window as unknown as MediaWindow).voiceMedia.denyCamera = false; });
      await viewer.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      await expect(host.locator('video')).toHaveCount(1);
      await expect(viewer.page.getByRole('switch', { name: '麦克风', exact: true })).not.toBeChecked();
      await viewer.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      await expect(host.locator('video')).toHaveCount(0);
      await expect.poll(() => viewer.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.tracks.every((track) => track.readyState === 'ended'))).toBe(true);

      await viewer.page.evaluate(() => { (window as unknown as MediaWindow).voiceMedia.holdCamera = true; });
      await viewer.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      await expect.poll(() => viewer.page.evaluate(() => !!(window as unknown as MediaWindow).voiceMedia.releaseCamera)).toBe(true);
      await viewer.page.getByRole('button', { name: '退出连麦', exact: true }).click();
      await expect(viewer.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();
      await viewer.page.evaluate(() => { (window as unknown as MediaWindow).voiceMedia.holdCamera = false; (window as unknown as MediaWindow).voiceMedia.releaseCamera?.(); });
      await expect.poll(() => viewer.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.tracks.every((track) => track.readyState === 'ended'))).toBe(true);
      await expect(host.locator('video')).toHaveCount(0);
      await expect(viewer.page.getByRole('region', { name: '我的连麦' })).toHaveCount(0);

      await viewer.page.getByRole('button', { name: '申请连麦' }).click();
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      await viewer.page.getByRole('switch', { name: '摄像头', exact: true }).click();
      await expect(host.locator('video')).toHaveCount(1);
      await viewer.page.getByRole('button', { name: '离开房间', exact: true }).click();
      await expect(host.locator('video')).toHaveCount(0);
      await expect.poll(() => viewer.page.evaluate(() => (window as unknown as MediaWindow).voiceMedia.tracks.every((track) => track.readyState === 'ended'))).toBe(true);
    } finally {
      await viewer.context.close();
      await rpc('DeleteRoom', { room: roomId });
    }
  });

  test('refresh and departure release the slot and old identities cannot approve or reapply', async ({ page: host, context, browser }) => {
    test.setTimeout(60_000);
    const roomId = `voice-e2e-${randomUUID()}`;
    const viewer = await guest(browser);
    const other = await guest(browser);
    await rpc('CreateRoom', { name: roomId, emptyTimeout: 30, metadata: JSON.stringify({ title: '连麦测试直播间', ownerId: 'live-test-host' }) });
    try {
      await login(context);
      const hostJoined = await join(host, roomId);
      const oldJoined = await join(viewer.page, roomId);
      await join(other.page, roomId);
      const oldRequestId = randomUUID();
      expect(await directVoice(viewer.page, roomId, oldJoined, '/request', oldRequestId)).toBe(200);
      await expect(other.page.getByRole('button', { name: '已有观众申请中' })).toBeDisabled();
      await host.getByRole('button', { name: '连麦 1', exact: true }).click();
      await host.getByRole('button', { name: '同意连麦', exact: true }).click();
      await viewer.page.getByRole('switch', { name: '麦克风', exact: true }).click();
      await expect(host.locator('audio')).toHaveCount(1);
      const response = viewer.page.waitForResponse((r) => r.url().endsWith(`/rooms/${roomId}/join`));
      await viewer.page.reload();
      const newJoined = await (await response).json() as Joined;
      expect(newJoined.identity).not.toBe(oldJoined.identity);
      await expect(viewer.page.getByText('已连接', { exact: true })).toBeVisible();
      await expect(viewer.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();
      await expect(host.locator('audio')).toHaveCount(0);
      expect(await directVoice(viewer.page, roomId, oldJoined, '/request', randomUUID())).toBe(403);
      expect(await directVoice(host, roomId, hostJoined, `/requests/${oldRequestId}/approve`, oldRequestId)).toBe(409);
      await viewer.page.getByRole('button', { name: '申请连麦' }).click();
      await expect(other.page.getByRole('button', { name: '已有观众申请中' })).toBeDisabled();
      await viewer.page.getByRole('button', { name: '离开房间', exact: true }).click();
      await expect(other.page.getByRole('button', { name: '申请连麦' })).toBeEnabled();
    } finally {
      await viewer.context.close();
      await other.context.close();
      await rpc('DeleteRoom', { room: roomId });
    }
  });
});
