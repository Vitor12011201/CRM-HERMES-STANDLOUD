export type DashboardRequestResult<T> =
  | { kind: "success"; data: T }
  | { kind: "unauthorized" }
  | { kind: "error" };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchDashboardData<T>(path: string, fetcher: FetchLike = fetch): Promise<DashboardRequestResult<T>> {
  try {
    const response = await fetcher(path, { cache: "no-store" });
    if (response.status === 401) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "error" };
    return { kind: "success", data: await response.json() as T };
  } catch {
    return { kind: "error" };
  }
}
