export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-PulseMonitor-Request": "1",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.message ?? "Request failed. Please try again.",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export type Project = { id: string; name: string; environment: string };
export type Metric = {
  count: number;
  errors: number;
  averageLatency: number | null;
  requestsPerSecond: number;
  errorRate: number;
};
export type Point = Metric & { bucket: string };
export type Endpoint = Metric & { route: string; method: string };
export type Key = {
  id: string;
  name: string;
  keyPrefix: string;
  revokedAt: string | null;
};
