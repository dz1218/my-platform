import { requestSessionVerification } from './session-events';
/** Fetch a fresh scoped ticket on every connection attempt; never persist it. */
export async function privateSocketURL(
  kind: "matches" | "conversation",
  signal: AbortSignal,
  conversationId?: string,
) {
  const endpoint = new URL("/api/realtime/connection", window.location.href);
  endpoint.searchParams.set("kind", kind);
  if (conversationId)
    endpoint.searchParams.set("conversationId", conversationId);
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status === 401) requestSessionVerification();
  if (!response.ok) throw new Error("实时连接暂时不可用");
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("url" in data) ||
    typeof data.url !== "string"
  )
    throw new Error("Invalid socket URL");
  const url = new URL(data.url);
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (window.location.protocol === "https:" && url.protocol !== "wss:")
  )
    throw new Error("Invalid socket URL");
  return url;
}
