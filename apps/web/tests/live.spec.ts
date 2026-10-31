import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const room = {
  id: "room-regression",
  title: "无需刷新直播间",
  status: "准备中",
  viewers: 0,
  canManage: true,
};
const fixture = "http://127.0.0.1:18181/__performance";
test.beforeEach(async ({ request }) => {
  await request.post(fixture, { data: {} });
});
test.afterEach(async ({ request }) => {
  await request.post(fixture, { data: {} });
});

async function login(context: BrowserContext) {
  await context.addCookies([
    {
      name: "companion_session",
      value: "live-test-host",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}

async function lobby(page: Page, items: (typeof room)[] = []) {
  await page.request.post(fixture, { data: { rooms: items } });
  await page.route(/\/api\/v1\/rooms(?:\/refresh)?$/, async (route) => {
    await route.fulfill({ json: { items } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("searchbox", { name: "搜索直播间" }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "刷新列表" })).toHaveCount(0);
}

test("create and close update immediately even when subsequent list requests fail", async ({
  page,
  context,
}) => {
  await login(context);
  let listFails = false;
  let creates = 0;
  let listReads = 0;
  await page.route(/\/api\/v1\/rooms(?:\/refresh)?$/, async (route) => {
    if (
      route.request().method() === "POST" &&
      !route.request().url().endsWith("/refresh")
    ) {
      creates++;
      listFails = true;
      await page.request.post(fixture, { data: { rooms: [room] } });
      return route.fulfill({ status: 201, json: { item: room } });
    }
    listReads++;
    return route.fulfill(
      listFails
        ? { status: 503, json: { error: { message: "测试服务暂不可用" } } }
        : { json: { items: [] } },
    );
  });
  await page.route(`**/api/v1/rooms/${room.id}`, async (route) => {
    await page.request.post(fixture, { data: { rooms: [] } });
    await route.fulfill({ json: { ok: true, state: "closed" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "我要开播", exact: true }).click();
  await page.getByRole("textbox", { name: "房间名称" }).fill(room.title);
  await page.getByRole("button", { name: "创建直播间", exact: true }).click();
  await expect(page.getByRole("article", { name: room.title })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "房间名称" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "我的直播间", exact: true }),
  ).toHaveAttribute("href", `/live/${room.id}`);
  await expect(
    page.getByRole("button", { name: "创建直播间", exact: true }),
  ).toHaveCount(0);
  const readsBeforeLeaving = listReads;
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "主导航", exact: true })
    .getByRole("link", { name: "小说", exact: true })
    .click();
  await expect(page).toHaveURL(/\/novels$/);
  await expect(
    page.getByRole("heading", { name: "小说", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航", exact: true })
    .getByRole("link", { name: "直播", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("实时更新", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("article", { name: room.title })).toBeVisible();
  expect(listReads).toBe(readsBeforeLeaving);
  expect(creates).toBe(1);
  await page.getByRole("button", { name: `关闭直播间：${room.title}` }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认关闭" })
    .click();
  await expect(page.getByRole("article", { name: room.title })).toHaveCount(0);
  await page.getByRole("button", { name: "我要开播", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "创建直播间", exact: true }),
  ).toBeEnabled();
});

test("a pushed snapshot updates another user’s room without a document reload", async ({
  page,
}) => {
  const items: (typeof room)[] = [];
  await lobby(page, items);
  await expect(page.getByText("暂无直播间", { exact: true })).toBeVisible();
  items.push(room);
  await page.request.post(fixture, { data: { rooms: items } });
  await expect(page.getByRole("article", { name: room.title })).toBeVisible();
  items.pop();
  await page.request.post(fixture, { data: { rooms: items } });
  await expect(page.getByText("暂无直播间", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
});

for (const status of ["准备中", "直播中"]) {
  test(`an owner's ${status} room replaces the creation form, and closing enables a new room`, async ({
    page,
    context,
  }) => {
    await login(context);
    const items = [{ ...room, status }];
    await lobby(page, items);
    await expect(
      page.getByRole("dialog", { name: "今晚，开场", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("link", { name: "我的直播间", exact: true }),
    ).toHaveAttribute("href", `/live/${room.id}`);
    await expect(
      page.getByRole("button", { name: "创建直播间", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "房间名称" })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 980 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: test.info().outputPath(`owned-room-${width}.png`),
        fullPage: true,
      });
    }
    await page.route(`**/api/v1/rooms/${room.id}`, (route) => {
      items.pop();
      return route.fulfill({ json: { ok: true, state: "closed" } });
    });
    await page
      .getByRole("button", { name: `关闭直播间：${room.title}` })
      .click();
    await page.getByRole("button", { name: "确认关闭" }).click();
    await page.getByRole("button", { name: "我要开播", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "创建直播间", exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "房间名称" })).toBeEnabled();
  });
}

test("a second tab creating a room shows a conflict without an entry dialog", async ({
  page,
  context,
}) => {
  await login(context);
  await lobby(page);
  let creates = 0;
  await page.route(/\/api\/v1\/rooms(?:\/refresh)?$/, (route) => {
    if (
      route.request().method() === "POST" &&
      !route.request().url().endsWith("/refresh")
    ) {
      creates++;
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "room_already_exists",
            message: "你已有一个直播间，请先关闭后再创建",
          },
          item: room,
        },
      });
    }
    return route.fulfill({ json: { items: [room] } });
  });
  await page.getByRole("button", { name: "我要开播", exact: true }).click();
  await page.getByRole("textbox", { name: "房间名称" }).fill("另一个房间");
  await page.getByRole("button", { name: "创建直播间", exact: true }).click();
  await expect(page.getByRole("link", { name: "进入我的直播间" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "已有一个直播间",
  );
  await expect(
    page.getByRole("button", { name: "创建直播间", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "房间名称" })).toHaveValue(
    "另一个房间",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: "我的直播间", exact: true }),
  ).toHaveAttribute("href", `/live/${room.id}`);
  expect(creates).toBe(1);
});

test("legacy duplicate rooms can be managed but cannot create another room", async ({
  page,
  context,
}) => {
  await login(context);
  await lobby(page, [
    room,
    { ...room, id: "room-legacy", title: "旧的第二个直播间" },
  ]);
  await expect(
    page.getByRole("link", { name: "我的直播间", exact: true }),
  ).toHaveAttribute("href", `/live/${room.id}`);
  await expect(page.getByRole("button", { name: /^关闭直播间：/ })).toHaveCount(
    2,
  );
  await expect(
    page.getByRole("button", { name: "创建直播间", exact: true }),
  ).toHaveCount(0);
});

test("a delayed error retry cannot undo a newer pushed snapshot", async ({
  page,
  context,
}) => {
  await login(context);
  await page.route("**/api/v1/rooms", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "列表暂不可用" } },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "重新加载" })).toBeEnabled();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let listStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    listStarted = resolve;
  });
  await page.route(/\/api\/v1\/rooms(?:\/refresh)?$/, async (route) => {
    listStarted();
    await delayed;
    await route.fulfill({ json: { items: [] } }).catch(() => {});
  });
  await page.getByRole("button", { name: "重新加载" }).click();
  await started;
  await page.request.post(fixture, { data: { rooms: [room] } });
  await expect(page.getByRole("article", { name: room.title })).toBeVisible();
  const finished = page.waitForResponse((response) =>
    response.url().endsWith("/rooms/refresh"),
  );
  release();
  await finished;
  await expect(
    page.getByRole("link", { name: "我的直播间", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "搜索直播间" }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "刷新列表" })).toHaveCount(0);
  await expect(page.getByRole("article", { name: room.title })).toBeVisible();
});

test("failed create preserves the title; Chinese composition does not submit", async ({
  page,
  context,
}) => {
  await login(context);
  await lobby(page);
  let creates = 0;
  await page.route(/\/api\/v1\/rooms(?:\/refresh)?$/, async (route) => {
    if (
      route.request().method() === "POST" &&
      !route.request().url().endsWith("/refresh")
    ) {
      creates++;
      return route.fulfill({
        status: 503,
        json: { error: { message: "创建失败，请重试" } },
      });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.getByRole("button", { name: "我要开播", exact: true }).click();
  const input = page.getByRole("textbox", { name: "房间名称" });
  await input.fill("中文标题");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
    keyCode: 229,
  });
  expect(creates).toBe(0);
  await input.press("Enter");
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "创建失败",
  );
  await expect(input).toHaveValue("中文标题");
  expect(creates).toBe(1);
});

for (const width of [390, 768, 1440])
  test(`guests see errors and can retry without a misleading empty state at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.request.post(fixture, {
      data: { failures: { "/api/v1/rooms": 503 } },
    });
    await page.route(/\/api\/v1\/rooms(?:\/refresh)?$/, (route) =>
      route.fulfill({
        status: 503,
        json: { error: { message: "直播服务暂不可用" } },
      }),
    );
    await page.goto("/");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "直播服务暂不可用",
    );
    await expect(page.getByText("暂无直播间", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "创建直播间", exact: true }),
    ).toHaveCount(0);
    await page.route(/\/api\/v1\/rooms(?:\/refresh)?$/, (route) =>
      route.fulfill({ json: { items: [room] } }),
    );
    await page.screenshot({
      path: test.info().outputPath(`retry-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "重新加载" }).click();
    await expect(page.getByRole("article", { name: room.title })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

test("returning to the lobby checks current room data in the background", async ({
  page,
}) => {
  const items = [room];
  await lobby(page, items);
  await page.getByRole("link", { name: "观看", exact: true }).click();
  await expect(page).toHaveURL(`/live/${room.id}`);
  items.pop();
  await page.request.post(fixture, { data: { rooms: items } });
  await page.getByRole("button", { name: "返回大厅", exact: true }).click();
  await expect(page.getByText("暂无直播间", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
});

test("temporary join errors keep loading; leaving waits for identity and cancels recovery", async ({
  page,
}) => {
  let attempts = 0;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/rooms/room-missing/join", async (route) => {
    attempts++;
    if (attempts > 1) await delayed;
    await route
      .fulfill({
        status: 503,
        json: { error: { message: "直播服务暂时不可用" } },
      })
      .catch(() => {});
  });
  await page.goto("/live/room-missing");
  await expect(page.getByRole("status", { name: "正在连接直播间", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("观众模式", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "观众昵称" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "申请连麦", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新加入", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.screenshot({
    path: test.info().outputPath("room-unavailable.png"),
    fullPage: true,
  });
  await expect.poll(() => attempts).toBe(2);
  await expect(
    page.getByRole("status", { name: "正在连接直播间", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取消连接", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "返回大厅", exact: true }).click();
  await expect(page.getByText("正在确认房间身份，请稍候…")).toBeVisible();
  await expect(page).toHaveURL("/live/room-missing");
  const retryResponse = page.waitForResponse(response => response.url().endsWith('/room-missing/join'));
  release();
  await retryResponse;
  await expect(page.getByRole("status", { name: "正在连接直播间", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "返回大厅", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  const requestsAtExit = attempts;
  await page.waitForTimeout(1500);
  expect(attempts).toBe(requestsAtExit);
});

for (const width of [390, 1440]) {
  test(`a second host page is refused without becoming a viewer or offering retry at ${width}px`, async ({
    page,
    context,
  }) => {
    await login(context);
    await page.setViewportSize({ width, height: 900 });
    let attempts = 0;
    await page.route(`**/api/v1/rooms/${room.id}/join`, (route) => {
      attempts++;
      expect(route.request().postDataJSON().attemptId).toBeTruthy();
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "host_session_in_use",
            message:
              "你已在另一个页面或设备进入此直播间，请使用原页面继续直播。",
          },
        },
      });
    });
    await page.goto(`/live/${room.id}`);
    await expect(
      page.getByRole("heading", { name: "此直播间已在其他页面打开" }),
    ).toBeVisible();
    await expect(page.getByText("观众模式", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^(重新加入|结束直播|申请连麦)$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "发送消息" }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole("link", { name: "返回直播大厅", exact: true })
        .filter({ hasText: "返回直播大厅" }),
    ).toBeVisible();
    // Resize reuses the same business owner; it must not retry the refused join.
    await page.setViewportSize({
      width: width === 390 ? 1440 : 390,
      height: 900,
    });
    await expect(
      page.getByRole("heading", { name: "此直播间已在其他页面打开" }),
    ).toBeVisible();
    expect(attempts).toBe(1);
  });

  test(`a closed room is terminal even if an obsolete lobby card remains at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route(`**/api/v1/rooms/${room.id}`, (route) =>
      route.fulfill({
        json: {
          item: room,
          state: "closed",
          reason: "host_left",
        },
      }),
    );
    await page.route(`**/api/v1/rooms/${room.id}/join`, (route) =>
      route.fulfill({
        status: 410,
        json: {
          error: { code: "room_closed", message: "直播间已结束" },
        },
      }),
    );
    await page.goto(`/live/${room.id}`);
    await expect(
      page.getByRole("heading", { name: "直播间已结束" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(重新加入|结束直播|申请连麦)$/ }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("link", { name: "返回直播大厅", exact: true })
        .filter({ hasText: "返回直播大厅" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "直播间已结束" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "重新加入" })).toHaveCount(0);
  });
}

for (const loggedIn of [true, false]) {
  test(`${loggedIn ? "logged-in viewer" : "guest"} never gets host controls from a legacy identity without an explicit role`, async ({
    page,
    context,
  }) => {
    if (loggedIn) await login(context);
    await page.route(`**/api/v1/rooms/${room.id}/join`, (route) =>
      route.fulfill({
        status: 201,
        json: {
          roomId: room.id,
          identity: "host_legacy_viewer",
          token: "legacy-token",
          livekitUrl: "ws://127.0.0.1:7880",
        },
      }),
    );
    await page.goto(`/live/${room.id}`);
    await expect(page.getByRole("status", { name: "正在连接直播间", exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /^(开启摄像头|开启麦克风|打开画面|呼叫 AI 助手)$/,
      }),
    ).toHaveCount(0);
    await expect(page.getByText("主播", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重新加入" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "取消连接" })).toBeEnabled();
  });
}

const entryScenarios = [true, false].flatMap((host) =>
  ["准备中", "直播中"].map((status) => ({ host, status })),
);

for (const { host, status } of entryScenarios) {
  test(`${host ? "host" : "viewer"} joins a ${status} room automatically with one click from the lobby`, async ({
    page,
    context,
  }) => {
    if (host) await login(context);
    let attempts = 0;
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/v1/rooms/${room.id}/join`, async (route) => {
      attempts++;
      await delayed;
      await route
        .fulfill({
          status: 503,
          json: { error: { message: "连接失败，请重试" } },
        })
        .catch(() => {});
    });
    await lobby(page, [
      { ...room, status, viewers: status === "直播中" ? 1 : 0 },
    ]);
    await page
      .getByRole("link", { name: host ? "进入直播间" : "观看", exact: true })
      .click();
    await expect(
      page.getByRole("status", { name: "正在连接直播间", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "取消连接", exact: true }),
    ).toBeEnabled();
    await expect.poll(() => attempts).toBe(1);
    await expect(
      page.getByRole("button", {
        name: /^(进入直播间|进入观看|开始直播|开启直播)$/,
      }),
    ).toHaveCount(0);
    release();
    await expect(page.getByRole("status", { name: "正在连接直播间", exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重新加入" })).toHaveCount(0);
    expect(attempts).toBe(1);
  });
}

test("room cards fit mobile and desktop widths", async ({ page, context }) => {
  await login(context);
  await lobby(page, [{ ...room, title: "一段很长的直播间标题".repeat(5) }]);
  const waitForPresentation = async (width: number) => {
    // The viewport event commits a different presentation; the old article can
    // still be visible for one frame immediately after setViewportSize.
    await expect(
      page.getByRole("heading", {
        name: width < 768 ? "直播" : "直播大厅",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
  };
  for (const width of [375, 844, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await waitForPresentation(width);
    await expect(page.getByRole("article")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect
      .poll(async () => {
        const [enter, close] = await Promise.all([
          page
            .getByRole("link", { name: "进入直播间", exact: true })
            .boundingBox(),
          page.getByRole("button", { name: /^关闭直播间/ }).boundingBox(),
        ]);
        return enter && close ? Math.abs(enter.y - close.y) : Infinity;
      })
      .toBeLessThanOrEqual(2);
  }
  await lobby(page, [
    { ...room, title: "下班了，一起聊聊今天", status: "直播中", viewers: 8 },
    {
      ...room,
      id: "room-reading",
      title: "陪你读一会儿书",
      status: "直播中",
      viewers: 3,
      canManage: false,
    },
    { ...room, id: "room-evening", title: "晚间闲聊，等你来坐坐" },
  ]);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 980 });
    await waitForPresentation(width);
    await page.screenshot({
      path: test.info().outputPath(`lobby-${width}.png`),
      fullPage: width > 500,
    });
  }
});

test("filters and search work together; closing can be cancelled with Escape", async ({
  page,
  context,
}) => {
  await login(context);
  await lobby(page, [
    room,
    {
      id: "room-live",
      title: "晚间读书",
      status: "直播中",
      viewers: 3,
      canManage: false,
    },
  ]);
  await page.getByRole("button", { name: "直播中" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "搜索直播间" }).fill("不存在");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "搜索直播间" }).press("Enter");
  await expect(page.getByText("没有找到相关直播间")).toBeVisible();
  await page.getByRole("button", { name: "清空搜索" }).click();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  const close = page.getByRole("button", { name: `关闭直播间：${room.title}` });
  await close.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(close).toBeFocused();
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("failed close keeps the confirmation and the room available", async ({
  page,
  context,
}) => {
  await login(context);
  await lobby(page, [room]);
  await page.route(`**/api/v1/rooms/${room.id}`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 503,
          json: { error: { message: "关闭失败，请重试" } },
        })
      : route.fulfill({ json: { item: room, state: "open" } }),
  );
  await page.getByRole("button", { name: `关闭直播间：${room.title}` }).click();
  await page.getByRole("button", { name: "确认关闭" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "关闭失败",
  );
  await expect(page.getByRole("article", { name: room.title })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
});

test("room names are required, unique, and server conflicts preserve input", async ({
  page,
  context,
}) => {
  await login(context);
  const otherRoom = { ...room, canManage: false };
  await lobby(page, [otherRoom]);
  let creates = 0;
  await page.route(/\/api\/v1\/rooms(?:\/refresh)?$/, (route) => {
    if (
      route.request().method() === "POST" &&
      !route.request().url().endsWith("/refresh")
    ) {
      creates++;
      return route.fulfill({
        status: 409,
        json: { error: { message: "这个房间名称已被使用，请换一个名称" } },
      });
    }
    return route.fulfill({ json: { items: [otherRoom] } });
  });
  await page.getByRole("button", { name: "我要开播", exact: true }).click();
  const input = page.getByRole("textbox", { name: "房间名称" });
  const create = page.getByRole("button", { name: "创建直播间", exact: true });
  await create.click();
  expect(creates).toBe(0);
  await input.fill("   ");
  await create.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "请输入",
  );
  await input.fill(`  ${room.title}  `);
  await create.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "已被使用",
  );
  expect(creates).toBe(0);
  await input.fill("其他房间");
  await create.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "已被使用",
  );
  await expect(input).toHaveValue("其他房间");
  expect(creates).toBe(1);
});
