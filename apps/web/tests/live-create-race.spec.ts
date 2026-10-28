import { expect, test } from "@playwright/test";

const fixture = "http://127.0.0.1:18181/__performance";
const room = {
  id: "created-room",
  title: "晚间电台",
  status: "准备中",
  viewers: 0,
  canManage: true,
};

test.beforeEach(async ({ request }) => {
  await request.post(fixture, { data: { rooms: [] } });
});
test.afterEach(async ({ request }) => {
  await request.post(fixture, { data: {} });
});

for (const width of [320, 390, 1440]) {
  test(`a room pushed before the create response does not show an entry dialog at ${width}px`, async ({
    page,
    context,
  }, info) => {
    await context.addCookies([
      {
        name: "companion_session",
        value: "live-test-host",
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
    await page.setViewportSize({ width, height: 900 });
    let release!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/rooms", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      // Real-time snapshots can arrive while the HTTP creation is still pending.
      await page.request.post(fixture, { data: { rooms: [room] } });
      await responseGate;
      await route.fulfill({ status: 201, json: { item: room } });
    });
    await page.goto("/");
    await expect(page.getByText("实时更新", { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: width >= 768 ? "我要开播" : "开播",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: width >= 768 ? "今晚，开场" : "我的直播间",
      exact: true,
    });
    await dialog.getByRole("textbox", { name: "房间名称" }).fill(room.title);
    await dialog
      .getByRole("button", { name: "创建直播间", exact: true })
      .click();
    try {
      await expect(
        page.locator("article").filter({ hasText: room.title }),
      ).toHaveCount(1);
      await page.screenshot({ path: info.outputPath("creation-pending.png") });
      await expect(
        dialog.getByRole("link", { name: "进入我的直播间" }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "创建中…", exact: true }),
      ).toBeDisabled();
    } finally {
      release();
    }
    await expect(dialog).toBeHidden();
    await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
    await expect(
      page.getByRole("link", { name: "我的直播间", exact: true }),
    ).toHaveAttribute("href", "/live/created-room");
    await expect(page).toHaveURL("/");
    await page.screenshot({ path: info.outputPath("creation-complete.png") });
  });
}
