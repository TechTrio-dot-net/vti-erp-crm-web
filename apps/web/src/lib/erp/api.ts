/**
 * Client for the quotation, catalog and administration API at /api/v1. It shares the signed-in
 * session with the rest of the app (bearer token, refreshed automatically) and reports failures as
 * ApiError, whose `field()` returns the validation message for one form field.
 */
import { authedFetch } from "@/lib/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors: Record<string, string[]> = {},
  ) {
    super(message);
  }

  /** First validation message for a field (e.g. "client_name" or "items.0.artist_id"). */
  field(name: string): string | undefined {
    return this.errors[name]?.[0];
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await authedFetch(path, { ...init, cache: "no-store", headers: { Accept: "application/json", ...init.headers } });
  } catch (error) {
    // authedFetch throws once the session has expired and it has sent the user to sign in
    throw new ApiError(0, error instanceof Error && error.message.includes("session") ? error.message : "Network error. Check your connection and try again.");
  }
}

async function request<T>(method: string, path: string, body?: unknown, prefix = "/v1"): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await send(`${prefix}${path}`, {
    method,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 403 ? "You don't have permission to do that." : "Something went wrong. Please try again.";
    throw new ApiError(response.status, data.message || fallback, data.errors ?? {});
  }
  return data as T;
}

/** POST to an /api route outside /v1 (e.g. /api/auth/change-password), with the same error handling */
export async function postRoute<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path.replace(/^\/api/, ""), body, "");
}

/** Opens a protected file (e.g. a payment screenshot) in a new tab */
export async function openProtectedFile(path: string): Promise<void> {
  // Opened before the download so the browser treats it as a response to the click, not a popup
  const tab = window.open("", "_blank");
  const response = await send(`/v1${path}`, { method: "GET", headers: { Accept: "*/*" } });
  if (!response.ok) {
    tab?.close();
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.message || "The file could not be opened.");
  }
  const url = URL.createObjectURL(await response.blob());
  if (tab) tab.location.href = url;
  else window.location.assign(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", withQuery(path, query)),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
};
