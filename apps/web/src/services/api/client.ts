export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public retryAfterMs?: number,
    public pendingUntil?: number,
  ) {
    super(message);
  }
}
export async function check(response: Response) {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new APIError(
      data?.error?.message ?? "暂时连接不上，请稍后再试",
      response.status,
      data?.error?.code,
      retryAfter(response.headers.get('Retry-After')),
      typeof data?.error?.pendingUntil === 'number' ? data.error.pendingUntil : undefined,
    );
  }
  return response;
}
export function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await check(
    await fetch(`/api/v1${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    }),
  );
  return response.json() as Promise<T>;
}
