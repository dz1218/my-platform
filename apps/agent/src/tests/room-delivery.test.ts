import assert from "node:assert/strict";
import test from "node:test";
import { createRoomDelivery } from "../room-delivery.js";

test("replays identical messages only to original recipients after trusted member readiness", async () => {
  const sent: { payload: Uint8Array; destination?: string }[] = [];
  const delivery = createRoomDelivery(async (payload, destination) => { sent.push({ payload, destination }); });
  const first = new TextEncoder().encode('{"v":1,"id":"one","text":"回答"}');
  await delivery.acknowledge("host");
  await delivery.publish(first, ["host", "viewer"]);
  await delivery.acknowledge("late-joiner");
  await delivery.acknowledge("viewer");
  await delivery.acknowledge("viewer");
  assert.deepEqual(sent, [{ payload: first, destination: undefined }, { payload: first, destination: "viewer" }]);
  delivery.close();
  await delivery.publish(first, ["host"]);
  assert.equal(sent.length, 2);
});

test("replay is bounded, targeted notices stay private and departed recipients are cleared", async () => {
  const sent: string[] = [];
  const delivery = createRoomDelivery(async (p, destination) => { if (destination) sent.push(`${destination}:${p[0]}`); });
  for (let i = 0; i < 25; i++) await delivery.publish(new Uint8Array([i]), ["one", "two"]);
  await delivery.publish(new Uint8Array([99]), ["one", "two"], "one");
  delivery.forget("two");
  await delivery.acknowledge("two");
  assert.deepEqual(sent, ["one:99"]);
  await delivery.acknowledge("one");
  assert.equal(sent.length, 21);
  assert.equal(sent[1], "one:6");
  delivery.close();
});
