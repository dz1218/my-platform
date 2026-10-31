import { OpenAIChatCompletionsModel } from "@openai/agents";
import OpenAI from "openai";

export function createModel(config: { LLM_API_KEY: string; LLM_BASE_URL: string; LLM_MODEL: string }, timeout = 85_000) {
  return new OpenAIChatCompletionsModel(new OpenAI({
    apiKey: config.LLM_API_KEY || "not-configured", baseURL: config.LLM_BASE_URL,
    timeout, maxRetries: 0,
  }), config.LLM_MODEL);
}
