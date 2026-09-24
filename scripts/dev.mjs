import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
for (const [command, args, directory] of [
  ['go', ['run', './cmd/api'], 'apps/server'],
  ['go', ['run', './cmd/worker'], 'apps/server'],
  ['pnpm', ['dev'], 'apps/agent'],
  ['pnpm', ['dev'], 'apps/web'],
]) {
  const child = spawn(command, args, { cwd: `${root}${directory}`, stdio: 'inherit', detached: true });
  children.push(child);
  child.on('error', error => { console.error(`${directory}: ${error.message}`); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(`${directory} exited (${code})`); stop(code || 1); } });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
