import {
  AutoSubscribe,
  cli,
  defineAgent,
  ServerOptions,
  WorkerPermissions,
  type JobContext,
} from "@livekit/agents";
import { RoomEvent } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import { createModel } from "./model.js";
import { roomEnvSchema, roomMetadata, sessionIsActive } from "./room-config.js";
import { createRoomAPI } from "./room-events.js";
import { createGovernedRoomChat } from "./room-governance.js";
import { createRoomModerator } from "./agents/room-moderator.js";

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
    const api = createRoomAPI(
      env.ROOM_API_URL,
      env.ROOM_AGENT_TOKEN,
      metadata,
      lifetime.signal,
    );
    const chat = createGovernedRoomChat({
      decide: createRoomModerator(
        createModel(env, 30000),
        api.output,
        api.history,
        env.LLM_STRUCTURED_OUTPUT,
      ),
      output: api.output,
    });
    const stop = () => {
      lifetime.abort();
      chat.close();
    };
    ctx.addShutdownCallback(async () => {
      stop();
      ctx.room.off(RoomEvent.Disconnected, stop);
    });
    ctx.room.on(RoomEvent.Disconnected, stop);
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_NONE);
    void api.listen(chat.receive).finally(() => {
      stop();
      ctx.shutdown("assistant room session ended");
    });
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
      permissions: new WorkerPermissions(false, false, false, false),
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
