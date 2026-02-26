import 'dotenv/config';
import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_AGENT_NAME: z.string().min(1).default('room-assistant'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1)
});

const roomIdSchema = z.string().min(3).max(128).regex(/^[a-zA-Z0-9_.-]+$/);

const joinRequestSchema = z.object({
  identity: z.string().trim().min(2).max(80).regex(/^\S+$/),
  name: z.string().trim().min(1).max(80).optional()
});

type RoomItem = {
  id: string;
  title: string;
  status: '直播中' | '准备中';
  viewers: number;
};

const createRoomSchema = z.object({
  id: z.string().min(3).max(128).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  title: z.string().min(1).max(100).optional()
});

const dispatchAgentSchema = z.object({
  agentName: z.string().trim().min(1).max(80).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
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

function buildRoomServiceClient() {
  const env = envSchema.parse(process.env);
  return new RoomServiceClient(
    toHttpLiveKitHost(env.LIVEKIT_URL),
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET
  );
}

function buildAgentDispatchClient() {
  const env = envSchema.parse(process.env);
  return new AgentDispatchClient(
    toHttpLiveKitHost(env.LIVEKIT_URL),
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET
  );
}

function toRoomItem(room: { name: string; metadata?: string; numParticipants?: number }): RoomItem {
  let title = room.name;

  if (room.metadata) {
    try {
      const meta = JSON.parse(room.metadata) as { title?: string };
      if (meta.title) {
        title = meta.title;
      }
    } catch {
      // Keep fallback title.
    }
  }

  const viewers = room.numParticipants ?? 0;
  return {
    id: room.name,
    title,
    status: viewers > 0 ? '直播中' : '准备中',
    viewers
  };
}

function generateRoomId() {
  return `room-${Math.random().toString(36).slice(2, 8)}`;
}

@Controller()
class AppController {
  @Get('health')
  health() {
    return { ok: true, service: 'api' };
  }

  @Get('rooms')
  async listRooms() {
    const roomService = buildRoomServiceClient();
    const result = await roomService.listRooms();
    return { items: result.map((room) => toRoomItem(room)) };
  }

  @Post('rooms')
  async createRoom(@Body() body: unknown) {
    const parsed = createRoomSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid request body');
    }

    const roomService = buildRoomServiceClient();
    const roomId = parsed.data.id ?? generateRoomId();
    const title = parsed.data.title ?? roomId;

    const created = await roomService.createRoom({
      name: roomId,
      metadata: JSON.stringify({ title }),
      maxParticipants: 50,
      emptyTimeout: 10 * 60
    });

    return { item: toRoomItem(created) };
  }

  @Post('rooms/:roomId/join')
  async joinRoom(@Param('roomId') roomIdInput: string, @Body() body: unknown) {
    const roomIdResult = roomIdSchema.safeParse(roomIdInput);
    if (!roomIdResult.success) {
      throw new BadRequestException('Invalid room id');
    }

    const parsed = joinRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid request body');
    }

    const env = envSchema.parse(process.env);
    const roomId = roomIdResult.data;

    const accessToken = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: parsed.data.identity,
      name: parsed.data.name ?? parsed.data.identity,
      ttl: '2h'
    });

    accessToken.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    return {
      token: await accessToken.toJwt(),
      livekitUrl: env.LIVEKIT_URL,
      roomId,
      identity: parsed.data.identity
    };
  }

  @Delete('rooms/:roomId')
  async closeRoom(@Param('roomId') roomIdInput: string) {
    const roomIdResult = roomIdSchema.safeParse(roomIdInput);
    if (!roomIdResult.success) {
      throw new BadRequestException('Invalid room id');
    }

    const roomService = buildRoomServiceClient();
    await roomService.deleteRoom(roomIdResult.data);
    return { ok: true };
  }

  @Post('rooms/:roomId/agent/dispatch')
  async dispatchAgent(@Param('roomId') roomIdInput: string, @Body() body: unknown) {
    const roomIdResult = roomIdSchema.safeParse(roomIdInput);
    if (!roomIdResult.success) {
      throw new BadRequestException('Invalid room id');
    }

    const parsed = dispatchAgentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid request body');
    }

    const env = envSchema.parse(process.env);
    const roomId = roomIdResult.data;
    const agentName = parsed.data.agentName ?? env.LIVEKIT_AGENT_NAME;
    const metadata = parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : undefined;

    const agentDispatchClient = buildAgentDispatchClient();
    const dispatch = await agentDispatchClient.createDispatch(roomId, agentName, { metadata });

    return {
      item: {
        id: dispatch.id,
        room: dispatch.room,
        agentName: dispatch.agentName,
        metadata: dispatch.metadata
      }
    };
  }

  @Get('rooms/:roomId/agent/dispatch')
  async listAgentDispatches(@Param('roomId') roomIdInput: string) {
    const roomIdResult = roomIdSchema.safeParse(roomIdInput);
    if (!roomIdResult.success) {
      throw new BadRequestException('Invalid room id');
    }

    const agentDispatchClient = buildAgentDispatchClient();
    const dispatches = await agentDispatchClient.listDispatch(roomIdResult.data);
    return {
      items: dispatches.map((dispatch) => ({
        id: dispatch.id,
        room: dispatch.room,
        agentName: dispatch.agentName,
        metadata: dispatch.metadata
      }))
    };
  }

  @Delete('rooms/:roomId/agent/dispatch/:dispatchId')
  async deleteAgentDispatch(
    @Param('roomId') roomIdInput: string,
    @Param('dispatchId') dispatchIdInput: string
  ) {
    const roomIdResult = roomIdSchema.safeParse(roomIdInput);
    if (!roomIdResult.success) {
      throw new BadRequestException('Invalid room id');
    }

    const dispatchId = dispatchIdInput.trim();
    if (!dispatchId) {
      throw new BadRequestException('Invalid dispatch id');
    }

    const agentDispatchClient = buildAgentDispatchClient();
    await agentDispatchClient.deleteDispatch(dispatchId, roomIdResult.data);
    return { ok: true };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

async function bootstrap() {
  const env = envSchema.parse(process.env);
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [env.WEB_ORIGIN],
    credentials: true
  });

  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.PORT}`);
}

bootstrap();
