import {
  AutoSubscribe,
  cli,
  defineAgent,
  ServerOptions,
  WorkerPermissions,
  type JobContext,
} from "@livekit/agents";
import {
  ParticipantKind,
  RoomEvent,
  type RemoteParticipant,
} from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import { createModel } from "./model.js";
import { createRoomAssistant } from "./agents/room-assistant.js";
import { createRoomChat, roomChatTopic } from "./room-chat.js";
import { roomEnvSchema, roomMetadata, sessionIsActive } from "./room-config.js";
import { createRoomDelivery, roomReadyTopic } from "./room-delivery.js";

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const env = roomEnvSchema.parse(process.env);
    const metadata = roomMetadata.parse(JSON.parse(ctx.job.metadata || "{}"));
    if (
      metadata.roomId !== ctx.job.room?.name ||
      metadata.roomSid !== ctx.job.room?.sid ||
      Date.now() > metadata.deadline ||
      !(await sessionIsActive(env.ROOM_API_URL, metadata))
    ) {
      ctx.shutdown("expired assistant session");
      return;
    }
    const lifetime = new AbortController();
    const delivery = createRoomDelivery(async (payload, destination) => {
      // Check the Go-owned generation before publishing, including late model results.
      const active =
        !lifetime.signal.aborted &&
        (await sessionIsActive(env.ROOM_API_URL, metadata, lifetime.signal));
      if (!active) throw new Error("inactive_session");
      if (lifetime.signal.aborted || !ctx.room.localParticipant) return;
      await ctx.room.localParticipant.publishData(payload, {
        reliable: true,
        topic: roomChatTopic,
        destination_identities: destination ? [destination] : undefined,
      });
    });
    const chat = createRoomChat({
      ask: createRoomAssistant(createModel(env, 30_000)),
      publish: (payload, destination) =>
        delivery.publish(
          payload,
          [...ctx.room.remoteParticipants.values()]
            .filter((p) => p.kind === ParticipantKind.STANDARD)
            .map((p) => p.identity),
          destination,
        ),
    });
    const receive = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (!participant || participant.kind !== ParticipantKind.STANDARD) return;
      if (topic === roomReadyTopic && payload.byteLength <= 32) {
        void delivery.acknowledge(participant.identity).catch(() => {});
        return;
      }
      if (topic !== roomChatTopic) return;
      chat.receive(payload, {
        identity: participant.identity,
        name: participant.name || "观众",
      });
    };
    const left = (participant: RemoteParticipant) =>
      delivery.forget(participant.identity);
    const stop = () => {
      lifetime.abort();
      chat.close();
      delivery.close();
      ctx.room.off(RoomEvent.DataReceived, receive);
      ctx.room.off(RoomEvent.ParticipantDisconnected, left);
    };
    const disconnect = () => {
      stop();
      ctx.shutdown("room disconnected");
    };
    ctx.addShutdownCallback(async () => {
      stop();
      ctx.room.off(RoomEvent.Disconnected, disconnect);
    });
    ctx.room.on(RoomEvent.DataReceived, receive);
    ctx.room.on(RoomEvent.ParticipantDisconnected, left);
    ctx.room.on(RoomEvent.Disconnected, disconnect);
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_NONE);
    console.info(
      JSON.stringify({
        event: "room_assistant_connected",
        sessionId: metadata.sessionId,
      }),
    );
    if (!(await sessionIsActive(env.ROOM_API_URL, metadata, lifetime.signal))) {
      stop();
      ctx.shutdown("session removed");
    }
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parsed = roomEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      `[room-assistant] Missing or invalid configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
    process.exit(1);
  }
  const env = parsed.data;
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: env.LIVEKIT_AGENT_NAME,
      wsURL: (env.LIVEKIT_INTERNAL_URL || env.LIVEKIT_URL).replace(
        /^http/,
        "ws",
      ),
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      port: env.ROOM_AGENT_PORT,
      permissions: new WorkerPermissions(false, false, true, false),
      numIdleProcesses: 1,
      drainTimeout: 5_000,
      shutdownProcessTimeout: 5_000,
      requestFunc: async (request) => {
        let metadata;
        try {
          metadata = roomMetadata.parse(
            JSON.parse(request.job.metadata || "{}"),
          );
        } catch {
          await request.reject();
          return;
        }
        if (
          metadata.roomId !== request.room?.name ||
          metadata.roomSid !== request.room?.sid ||
          Date.now() > metadata.deadline ||
          !(await sessionIsActive(env.ROOM_API_URL, metadata).catch(
            () => false,
          ))
        ) {
          await request.reject();
          return;
        }
        await request.accept("AI 助手", `assistant_${metadata.sessionId}`);
      },
    }),
  );
}
