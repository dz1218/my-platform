import { config } from "dotenv";
import { z } from "zod";
config({ path: ".env", quiet: true });
export const env = z
  .object({
    AGENT_HOST: z.string().default("127.0.0.1"),
    AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
    AGENT_TOKEN: z.string().min(32),
    COMPANION_RUNTIME: z.enum(["legacy", "langgraph", "shadow"]).default("legacy"),
    COMPANION_ROLLOUT_PERCENT: z.coerce.number().int().min(0).max(100).default(100),
    COMPANION_RELEASE_REPORT: z.string().default(""),
    AGENT_DATABASE_URL: z.string().default(""),
    AGENT_SERVER_URL: z.string().url().default("http://127.0.0.1:8080"),
    EMBEDDING_BASE_URL: z.string().url().default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
    EMBEDDING_API_KEY: z.string().default(""),
    EMBEDDING_MODEL: z.string().default("text-embedding-v4"),
    LLM_BASE_URL: z.string().url().default("https://api.deepseek.com"),
    LLM_API_KEY: z.string().default(""),
    LLM_MODEL: z.string().default("deepseek-flash"),
    LLM_STRUCTURED_OUTPUT: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .parse(process.env);
