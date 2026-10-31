import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Child already exited. */ }
  }
}
const localEnv = path => { try { return parseEnv(readFileSync(`${root}${path}`, 'utf8')); } catch { return {}; } };
const roomEnv = { ...localEnv('apps/server/.env'), ...localEnv('apps/agent/.env'), ...process.env };
const missingRoomConfig = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LLM_API_KEY'].filter(key => !roomEnv[key]);
if (missingRoomConfig.length) console.warn(`[room-assistant] Not started; configure ${missingRoomConfig.join(', ')} to enable live-room AI.`);
for (const [command, args, directory, optional] of [
  ['go', ['run', './cmd/api'], 'apps/server'],
  ['go', ['run', './cmd/worker'], 'apps/server'],
  ['pnpm', ['dev'], 'apps/agent'],
  ['pnpm', ['dev'], 'apps/web'],
  ...(missingRoomConfig.length ? [] : [['pnpm', ['dev:livekit'], 'apps/agent', true]]),
]) {
  const child = spawn(command, args, { cwd: `${root}${directory}`, stdio: 'inherit', detached: true });
  children.push(child);
  child.on('error', error => { console.error(`${directory}: ${error.message}`); if (!optional) stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(`${directory} exited (${code})`); if (!optional) stop(code || 1); } });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
