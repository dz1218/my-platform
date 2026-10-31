import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createAgentServer } from "../server.js";
import { replyErrorCode } from "../reply-error.js";

test("foreground saturation leaves the independent background lane available", async () => {
  let release!: () => void, entered!: () => void, backgroundEntered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const foregroundReady = new Promise<void>(resolve => { entered = resolve; });
  const backgroundReady = new Promise<void>(resolve => { backgroundEntered = resolve; });
  let active = 0;
  const server = createAgentServer('test-token', async input => {
    if (input.kind === 'CONTEXT_UPDATE') backgroundEntered(); else if (++active === 4) entered();
    await pending;
    return { action: 'SILENCE', messages: [], promptVersion: 'test' };
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/agent/generate-plan`;
  const send = (kind = 'TURN_REPLY') => fetch(url, { method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: JSON.stringify({ kind, messages: [{ role: 'system', content: 'identity' }] }), signal: AbortSignal.timeout(5000) });
  const requests = Array.from({ length: 4 }, () => send());
  try {
    await foregroundReady;
    assert.equal((await send()).status, 503);
    const background = send('CONTEXT_UPDATE'); requests.push(background); await backgroundReady;
    assert.equal((await send('CONTEXT_UPDATE')).status, 503);
    release();
    for (const response of await Promise.all(requests)) { assert.equal(response.status, 200); await response.text(); }
  } finally { release(); await Promise.allSettled(requests); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("reply diagnostics classify failures without logging provider details", () => {
  assert.equal(
    replyErrorCode(new SyntaxError("private output")),
    "invalid_model_json",
  );
  assert.equal(
    replyErrorCode({ status: 429, message: "private token" }),
    "provider_http_429",
  );
  assert.equal(
    replyErrorCode({ name: "APIConnectionTimeoutError" }),
    "generation_timeout",
  );
  assert.equal(
    replyErrorCode(new Error("private prompt")),
    "generation_failed",
  );
});

test("private API authenticates and returns an SSE reply stream", async () => {
  let calls = 0;
  const server = createAgentServer("test-token", async () => {
    calls++;
    return { content: "你好", promptVersion: "test-v1" };
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/reply`;
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    assert.equal(calls, 0);
    const invalid = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: "{}",
    });
    assert.equal(invalid.status, 400);
    const result = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "identity" },
          { role: "user", content: "hello" },
        ],
      }),
    });
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type")!, /text\/event-stream/);
    const stream = await result.text();
    assert.match(stream, /: connected\n\n/);
    assert.match(stream, /event: reply\ndata: /);
    assert.deepEqual(JSON.parse(stream.split("data: ")[1].trim()), {
      content: "你好",
      promptVersion: "test-v1",
    });
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("SSE headers arrive before generation finishes and failures use an error event", async () => {
  let fail!: (error: Error) => void;
  const generation = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  const server = createAgentServer("test-token", () => generation);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const result = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/reply`,
      {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({
          messages: [
            { role: "system", content: "identity" },
            { role: "user", content: "hello" },
          ],
        }),
      },
    );
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type")!, /text\/event-stream/);
    fail(new Error("private provider details"));
    const stream = await result.text();
    assert.match(stream, /event: error/);
    assert.doesNotMatch(stream, /private provider details/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("generate-plan exposes authenticated JSON candidates only", async () => {
  const plan = {
    action: "SILENCE",
    messages: [],
    promptVersion: "companion-v2",
  };
  const server = createAgentServer("test-token", async () => plan);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/agent/generate-plan`;
    const result = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        kind: "PROACTIVE",
        messages: [{ role: "system", content: "authorized snapshot" }],
      }),
    });
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type")!, /application\/json/);
    assert.deepEqual(await result.json(), plan);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
