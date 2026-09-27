// Only fixed categories and HTTP status codes may enter logs; provider error
// messages can contain prompts, model output, URLs, or credentials.
export function replyErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "generation_failed";
  const e = error as { name?: unknown; status?: unknown; message?: unknown };
  if (typeof e.status === "number" && Number.isInteger(e.status) && e.status >= 400 && e.status <= 599)
    return `provider_http_${e.status}`;
  if (e.name === "SyntaxError") return "invalid_model_json";
  if (e.name === "ZodError") return "invalid_model_action";
  if (e.name === "AbortError" || e.name === "TimeoutError" || e.name === "APIConnectionTimeoutError")
    return "generation_timeout";
  if (e.name === "APIConnectionError") return "provider_connection_failed";
  switch (e.message) {
    case "Incomplete model response": return "incomplete_model_response";
    case "Unexpected tool call": return "unexpected_tool_call";
    case "Wait exceeds execution limits": return "invalid_wait_action";
    case "Invalid reply length": return "invalid_reply_length";
    default: return "generation_failed";
  }
}
