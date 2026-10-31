// Local OpenAI-compatible model fixture; production never imports this module.
import { createServer } from 'node:http';
let calls: { content: string }[][] = [];
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') { res.end('{"ok":true}'); return; }
  if (req.url === '/calls') { res.end(JSON.stringify(calls)); return; }
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end('{}'); return; }
  let body = ''; for await (const chunk of req) body += chunk;
  const wire = JSON.parse(body) as { messages: { role: string; content: string | { type: string; text?: string }[] }[] };
  const input = { messages: wire.messages.map(m => ({ ...m, content: typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('') })) };
  calls.push(input.messages);
  const user = input.messages.filter(m => m.role === 'user');
  const question = JSON.parse(user.at(-1)!.content).question as string;
  if (question === '慢回答') await new Promise(r => setTimeout(r, 2000));
  res.end(JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion', created: 1, model: 'room-fixture', choices: [{ index: 0, message: { role: 'assistant', content: `测试回答（第${user.length}轮）：${question}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
});
server.listen(18183, '127.0.0.1');
process.on('SIGTERM', () => server.close());
