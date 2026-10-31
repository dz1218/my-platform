import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createHmac } from "node:crypto";

// Only model and LiveKit fields below are used; never copy secrets to dispatch metadata.
config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
try {
  const server = parse(
    readFileSync(new URL("../../server/.env", import.meta.url)),
  );
  for (const key of [
    "LIVEKIT_URL",
    "LIVEKIT_INTERNAL_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "LIVEKIT_AGENT_NAME",
    "ROOM_AGENT_TOKEN",
    "AGENT_TOKEN",
  ]) {
    if (process.env[key] === undefined && server[key] !== undefined)
      process.env[key] = server[key];
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (
  !process.env.ROOM_AGENT_TOKEN &&
  process.env.AGENT_TOKEN &&
  process.env.AGENT_TOKEN.length >= 32
)
  process.env.ROOM_AGENT_TOKEN = createHmac("sha256", process.env.AGENT_TOKEN)
    .update("live-room-agent:v1")
    .digest("hex");
export const roomEnvSchema = z.object({
  LLM_STRUCTURED_OUTPUT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ROOM_AGENT_TOKEN: z.string().min(32),
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_INTERNAL_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_AGENT_NAME: z.string().min(1).default("room-assistant"),
  ROOM_API_URL: z.string().url().default("http://127.0.0.1:8080"),
  ROOM_AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(8082),
  LLM_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1).default("deepseek-flash"),
});
export const roomMetadata = z.object({
  roomId: z.string().regex(/^[a-zA-Z0-9_.-]{3,128}$/),
  roomSid: z.string(),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/),
  deadline: z.number().int().positive(),
});

export async function sessionIsActive(
  api: string,
  metadata: z.infer<typeof roomMetadata>,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `${api.replace(/\/$/, "")}/api/v1/rooms/${encodeURIComponent(metadata.roomId)}`,
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(5_000)])
        : AbortSignal.timeout(5_000),
      headers: { "Cache-Control": "no-cache" },
    },
  );
  if (!response.ok) return false;
  const detail = (await response.json()) as {
    state?: string;
    assistant?: { status?: string; sessionId?: string };
  };
  return (
    detail.state === "open" &&
    detail.assistant?.sessionId === metadata.sessionId &&
    (detail.assistant.status === "starting" ||
      detail.assistant.status === "online")
  );
}
