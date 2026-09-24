export class APIError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function check(response: Response) {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new APIError(data?.error?.message ?? '暂时连接不上，请稍后再试', response.status, data?.error?.code);
  }
  return response;
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await check(await fetch(`/api/v1${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, cache: 'no-store' }));
  return response.json() as Promise<T>;
}
