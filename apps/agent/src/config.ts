import { config } from 'dotenv';
import { z } from 'zod';
config({ path: '.env', quiet: true });
export const env = z.object({
  AGENT_HOST: z.string().default('127.0.0.1'),
  AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  AGENT_TOKEN: z.string().min(32),
  LLM_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('deepseek-flash'),
  PROMPT_VERSION: z.string().default('conversation-v2'),
}).parse(process.env);
