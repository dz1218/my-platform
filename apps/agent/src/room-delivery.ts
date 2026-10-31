// Signaling membership can arrive after reliable data. Keep a bounded replay
// only for recipients present when an answer was sent, until their browser has
// confirmed that it knows this Agent participant. Message IDs remain unchanged.
export const roomReadyTopic = "room-assistant.ready.v1";
export function createRoomDelivery(
  send: (payload: Uint8Array, destination?: string) => Promise<void>,
) {
  const ready = new Set<string>();
  const pending = new Map<string, Uint8Array[]>();
  let closed = false;
  return {
    async publish(
      payload: Uint8Array,
      participants: string[],
      destination?: string,
    ) {
      if (closed) return;
      for (const id of destination ? [destination] : participants) {
        if (ready.has(id)) continue;
        if (!pending.has(id) && pending.size >= 2000) continue;
        const messages = pending.get(id) ?? [];
        messages.push(payload);
        if (messages.length > 20) messages.shift();
        pending.set(id, messages);
      }
      await send(payload, destination);
    },
    async acknowledge(identity: string) {
      if (closed || ready.has(identity)) return;
      ready.add(identity);
      const messages = pending.get(identity) ?? [];
      pending.delete(identity);
      for (const payload of messages) {
        if (closed) return;
        await send(payload, identity);
      }
    },
    forget(identity: string) {
      ready.delete(identity);
      pending.delete(identity);
    },
    close() {
      closed = true;
      ready.clear();
      pending.clear();
    },
  };
}
