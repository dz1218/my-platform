# apps/agent

This app is a bootstrap for LiveKit agent integration in this repo.

Current behavior:
- Reads LiveKit credentials from env.
- Keeps a long-running process for deployment wiring.
- Checks Agent Dispatch API connectivity periodically.

To upgrade to a real in-room AI assistant:
1. Install official LiveKit Agents runtime and your model plugin.
2. Register worker with `agentName = LIVEKIT_AGENT_NAME`.
3. Handle room audio/data and emit text/voice responses.
4. Keep API dispatch endpoints (`/rooms/:roomId/agent/dispatch`) as the trigger entry.
