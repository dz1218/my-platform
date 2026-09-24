import 'dotenv/config';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { z } from 'zod';

const envSchema = z.object({
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_AGENT_NAME: z.string().min(1).default('room-assistant')
});

function toHttpLiveKitHost(wsUrl: string) {
  if (wsUrl.startsWith('wss://')) {
    return wsUrl.replace('wss://', 'https://');
  }
  if (wsUrl.startsWith('ws://')) {
    return wsUrl.replace('ws://', 'http://');
  }
  return wsUrl;
}

async function bootstrap() {
  const env = envSchema.parse(process.env);

  const dispatchClient = new AgentDispatchClient(
    toHttpLiveKitHost(env.LIVEKIT_URL),
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET
  );

  // Keep a minimal worker alive and verify Agent APIs are reachable.
  // Replace this process with a full LiveKit Agents worker when integrating LLM/TTS/STT.
  setInterval(async () => {
    try {
      await dispatchClient.listDispatch('health-check-room');
      console.log(`[agent] ready: ${env.LIVEKIT_AGENT_NAME}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[agent] dispatch API check failed: ${message}`);
    }
  }, 30_000);

  console.log(`[agent] placeholder worker started, agentName=${env.LIVEKIT_AGENT_NAME}`);
}

bootstrap();
