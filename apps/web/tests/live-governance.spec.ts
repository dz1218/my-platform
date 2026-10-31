import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function rpc(method: string, body: Record<string, unknown>) {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const signed = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: process.env.LIVEKIT_TEST_API_KEY || "devkey", nbf: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, video: { roomCreate: true, roomAdmin: true, room: body.room || body.name } })}`;
  const token = `${signed}.${createHmac(
    "sha256",
    process.env.LIVEKIT_TEST_API_SECRET || "devsecretdevsecretdevsecretdevsec",
  )
    .update(signed)
    .digest("base64url")}`;
  const response = await fetch(
    `${(process.env.LIVEKIT_TEST_URL || "http://127.0.0.1:7880").replace(/^ws/, "http")}/twirp/livekit.RoomService/${method}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  expect(
    response.ok || (method === "DeleteRoom" && response.status === 404),
  ).toBe(true);
  return response.status === 404 ? {} : response.json();
}
async function sync() {
  const response = await fetch("http://127.0.0.1:18182/__sync", {
    method: "POST",
  });
  expect(response.ok).toBe(true);
}
async function enter(page: Page, room: string) {
  const joining = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/rooms/${room}/join`) &&
      r.request().method() === "POST",
  );
  await page.goto(`http://127.0.0.1:3012/live/${room}`);
  const response = await joining;
  expect(response.status()).toBe(201);
  const result = await response.json();
  await expect(page.getByText("已连接", { exact: true })).toBeVisible();
  await sync();
  return result as {
    token: string;
    voiceToken: string;
    identity: string;
    livekitUrl: string;
    roomToken: string;
    member: { id: string; name: string; code: string };
  };
}
async function send(page: Page, text: string) {
  const sent = page.waitForResponse((response) =>
    response.url().endsWith("/messages") && response.request().method() === "POST",
  );
  await page.getByRole("textbox", { name: "发送消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = await sent;
  expect(response.ok()).toBe(true);
  return (await response.json()).message as { id: string };
}
test.describe("live governance with real LiveKit", () => {
  test.skip(
    process.env.LIVEKIT_INTEGRATION !== "1" ||
      process.env.ROOM_ASSISTANT_INTEGRATION !== "1",
    "Requires LiveKit and isolated room assistant fixtures",
  );
  for (const mobile of [false, true])
    test(`${mobile ? "phone" : "desktop"} stable guests, public replies, moderation and re-entry`, async ({
      page: host,
      context,
      browser,
    }) => {
      test.setTimeout(150000);
      const room = `voice-e2e-${randomUUID()}`;
      const viewport = mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 960 };
      await host.setViewportSize(viewport);
      const firstContext = await browser.newContext({ viewport });
      const secondContext = await browser.newContext({ viewport });
      const first = await firstContext.newPage();
      const second = await secondContext.newPage();
      await context.addCookies([
        {
          name: "companion_session",
          value: "live-test-host",
          domain: "127.0.0.1",
          path: "/",
        },
      ]);
      await rpc("CreateRoom", {
        name: room,
        emptyTimeout: 60,
        metadata: JSON.stringify({
          ownerId: "live-test-host",
          title: "房管验收",
        }),
      });
      await sync();
      try {
        const hostJoin = await enter(host, room);
        const firstJoin = await enter(first, room);
        const secondJoin = await enter(second, room);
        expect(firstJoin.member.name).not.toBe(secondJoin.member.name);
        expect(firstJoin.member.name).toMatch(/^听众·/);
        await expect(
          host.getByRole("button", { name: "房间设置", exact: true }),
        ).toBeVisible();
        await host
          .getByRole("button", { name: "房间设置", exact: true })
          .click();
        await host
          .getByRole("textbox", { name: "置顶公告", exact: true })
          .fill("欢迎来到房管验收直播");
        await host
          .getByRole("button", { name: "保存设置", exact: true })
          .click();
        await expect(
          first.getByText("欢迎来到房管验收直播", { exact: true }),
        ).toBeVisible();
        if (mobile)
          await host
            .getByRole("button", { name: "设备与助手", exact: true })
            .click();
        await host
          .getByRole("button", { name: "呼叫 AI 助手", exact: true })
          .click();
        await expect
          .poll(
            async () => {
              await sync();
              return (
                await (await host.request.get(`/api/v1/rooms/${room}`)).json()
              ).assistant?.status;
            },
            { timeout: 35000, intervals: [500, 1000] },
          )
          .toBe("online");
        if (mobile)
          await host
            .getByRole("button", { name: "关闭设备与助手", exact: true })
            .click();
        await send(first, "@AI 你好");
        for (const page of [host, first, second])
          await expect(
            page.getByText("测试回答：你好", { exact: true }),
          ).toBeVisible({ timeout: 15000 });
        await send(second, "请问几点下播？");
        await expect(
          host.getByText("测试自动回复：请问几点下播？", { exact: true }),
        ).toBeVisible({ timeout: 15000 });
        const voiceRequestId = randomUUID();
        const requested = await first.request.post(
          `/api/v1/rooms/${room}/voice/request`,
          {
            headers: { "X-Live-Voice-Token": firstJoin.voiceToken },
            data: { requestId: voiceRequestId },
          },
        );
        expect(requested.status()).toBe(200);
        const approved = await host.request.post(
          `/api/v1/rooms/${room}/voice/requests/${voiceRequestId}/approve`,
          {
            headers: { "X-Live-Voice-Token": hostJoin.voiceToken },
            data: { requestId: voiceRequestId },
          },
        );
        expect(approved.status()).toBe(200);
        const permission = (
          await rpc("ListParticipants", { room })
        ).participants.find(
          (p: { identity: string }) => p.identity === firstJoin.identity,
        ).permission;
        expect(permission.canPublish ?? permission.can_publish).toBe(true);
        expect(
          permission.canPublishData ?? permission.can_publish_data ?? false,
        ).toBe(false);
        if (!mobile) {
          await first
            .getByRole("switch", { name: "麦克风", exact: true })
            .click();
          await expect
            .poll(
              async () =>
                (
                  (await rpc("ListParticipants", { room })).participants.find(
                    (p: { identity: string }) =>
                      p.identity === firstJoin.identity,
                  ).tracks ?? []
                ).length,
            )
            .toBeGreaterThan(0);
        }
        const manage = () =>
          host
            .getByRole("button", {
              name: `管理 ${firstJoin.member.name}`,
              exact: true,
            })
            .first();
        const composer = host.getByRole("textbox", { name: "发送消息", exact: true });
        await manage().click({ button: "right" });
        await expect(composer).toHaveValue(`@${firstJoin.member.name} `);
        await expect(composer).toBeFocused();
        await expect(host.getByRole("dialog")).toBeHidden();
        const reply = `@${firstJoin.member.name} 收到你的消息`;
        await send(host, reply);
        await expect(first.getByText(reply, { exact: true })).toBeVisible();
        await expect(first.getByRole("textbox", { name: "发送消息", exact: true })).toBeEnabled();
        await first.getByRole("button", { name: `提及 ${secondJoin.member.name}`, exact: true }).first().click({ button: "right" });
        await expect(first.getByRole("textbox", { name: "发送消息", exact: true })).toHaveValue(`@${secondJoin.member.name} `);
        await first.getByRole("textbox", { name: "发送消息", exact: true }).fill("");
        await composer.fill("@AI");
        await host.getByRole("button", { name: `管理 ${firstJoin.member.name}（头像）`, exact: true }).first().click({ button: "right" });
        await expect(composer).toHaveValue(`@AI @${firstJoin.member.name} `);
        await composer.pressSequentially("禁言他");
        await expect(composer).toHaveValue(`@AI @${firstJoin.member.name} 禁言他`);
        await expect(composer).toBeFocused();
        await expect(first.getByRole("textbox", { name: "发送消息", exact: true })).toBeEnabled();
        await expect(host.getByRole("button", { name: /^禁言 .*5 分钟$/ })).toHaveCount(0);
        await host.screenshot({ path: test.info().outputPath("chat-mention-draft.png"), fullPage: true });
        await host.getByRole("button", { name: "发送", exact: true }).click();
        await expect(host.getByRole("dialog")).toBeHidden();
        await expect(
          first.getByRole("textbox", { name: "发送消息", exact: true }),
        ).toBeDisabled();
        await expect
          .poll(async () => {
            const p = (
              await rpc("ListParticipants", { room })
            ).participants.find(
              (p: { identity: string }) => p.identity === firstJoin.identity,
            );
            return (
              (p.permission.canPublish ?? p.permission.can_publish ?? false) ===
                false && (p.tracks ?? []).length === 0
            );
          })
          .toBe(true);
        const blockedVoice = await first.request.post(
          `/api/v1/rooms/${room}/voice/request`,
          {
            headers: { "X-Live-Voice-Token": firstJoin.voiceToken },
            data: { requestId: randomUUID() },
          },
        );
        expect(blockedVoice.status()).toBe(403);
        const denied = await first.request.post(
          `/api/v1/rooms/${room}/messages`,
          {
            headers: { "X-Live-Room-Token": firstJoin.roomToken },
            data: { requestId: randomUUID(), text: "绕过输入框" },
          },
        );
        expect(denied.status()).toBe(403);
        await expect(
          second.getByRole("textbox", { name: "发送消息", exact: true }),
        ).toBeEnabled();
        await manage().click();
        await host.screenshot({
          path: test.info().outputPath("member-moderation.png"),
          fullPage: true,
        });
        await host
          .getByRole("button", { name: "解除禁言", exact: true })
          .click();
        await expect(
          first.getByRole("textbox", { name: "发送消息", exact: true }),
        ).toBeEnabled();
        await expect(host.getByRole("dialog")).toBeHidden();
        const command = await send(host, `@AI 把${secondJoin.member.name}禁言`);
        await expect(second.getByRole("textbox", { name: "发送消息", exact: true })).toBeDisabled();
        await expect(host.getByRole("dialog")).toBeHidden();
        const activity = await host.request.get(`/api/v1/rooms/${room}/activity`, {
          headers: { "X-Live-Room-Token": hostJoin.roomToken },
        });
        const actions = (await activity.json()).actions;
        const commandActions = actions.filter((a: { requestId: string }) => a.requestId === command.id);
        expect(commandActions).toHaveLength(1);
        expect(commandActions[0]).toMatchObject({ memberId: secondJoin.member.id, kind: "mute", status: "applied" });
        await host.getByRole("button", { name: `管理 ${secondJoin.member.name}`, exact: true }).first().click();
        await host.getByRole("button", { name: "解除禁言", exact: true }).click();
        await expect(second.getByRole("textbox", { name: "发送消息", exact: true })).toBeEnabled();
        await expect(host.getByRole("dialog")).toBeHidden();
        const kickCommand = await send(host, `@AI @${firstJoin.member.name} 踢出他`);
        await expect(host.getByRole("dialog")).toBeHidden();
        const afterKick = await host.request.get(`/api/v1/rooms/${room}/activity`, {
          headers: { "X-Live-Room-Token": hostJoin.roomToken },
        });
        const kickActions = (await afterKick.json()).actions.filter((a: { requestId: string }) => a.requestId === kickCommand.id);
        expect(kickActions).toHaveLength(1);
        expect(kickActions[0]).toMatchObject({ memberId: firstJoin.member.id, kind: "kick", status: "applied" });
        await expect(
          first.getByRole("heading", { name: "已被移出直播间", exact: true }),
        ).toBeVisible();
        await first.reload();
        await expect(
          first.getByRole("heading", { name: "已被移出直播间", exact: true }),
        ).toBeVisible();
        if (!mobile) {
          const probe = await firstContext.newPage();
          await probe.goto("http://127.0.0.1:3012/");
          await probe.addScriptTag({
            path: resolve(
              "node_modules/livekit-client/dist/livekit-client.umd.js",
            ),
          });
          const replayed = await probe.evaluate(
            async ({ livekitUrl, token }) => {
              const sdk = (
                window as unknown as {
                  LivekitClient: typeof import("livekit-client");
                }
              ).LivekitClient;
              const room = new sdk.Room();
              try {
                await room.connect(livekitUrl, token);
                return true;
              } catch {
                return false;
              }
            },
            firstJoin,
          );
          if (replayed) {
            await sync();
            await expect
              .poll(async () =>
                (await rpc("ListParticipants", { room })).participants.some(
                  (p: { identity: string }) =>
                    p.identity === firstJoin.identity,
                ),
              )
              .toBe(false);
          }
          await probe.close();
        }
        await host.getByRole("button", { name: /^管理记录/ }).click();
        await host.screenshot({
          path: test.info().outputPath("moderation-history.png"),
          fullPage: true,
        });
        await host
          .getByRole("button", { name: "解除限制", exact: true })
          .click();
        const rejoined = await enter(first, room);
        expect(rejoined.member.id).toBe(firstJoin.member.id);
        expect(rejoined.member.name).toBe(firstJoin.member.name);
        const forbidden = await second.request.post(
          `/api/v1/rooms/${room}/moderation`,
          {
            headers: { "X-Live-Room-Token": secondJoin.roomToken },
            data: {
              requestId: randomUUID(),
              kind: "kick",
              memberId: hostJoin.member.id,
            },
          },
        );
        expect(forbidden.status()).toBe(403);
        if (mobile) {
          await host.setViewportSize({ width: 320, height: 740 });
          await host
            .getByRole("button", { name: "房间设置", exact: true })
            .click();
          await expect(host.getByRole("dialog")).toBeVisible();
          expect(
            await host.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          ).toBe(true);
          await host.screenshot({
            path: test.info().outputPath("settings-320.png"),
            fullPage: true,
          });
          const save = host.getByRole("button", {
            name: "保存设置",
            exact: true,
          });
          await save.scrollIntoViewIfNeeded();
          await expect(save).toBeInViewport();
          await host.keyboard.press("Escape");
          await expect(host.getByRole("dialog")).toBeHidden();
          await expect(
            host.getByRole("button", { name: "房间设置", exact: true }),
          ).toBeFocused();
        }
      } finally {
        await rpc("DeleteRoom", { room });
        await sync();
        await firstContext.close();
        await secondContext.close();
      }
    });
});
