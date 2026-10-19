import { useAuthStore } from "@/store/auth";

/** The API is served by this same Next.js app (src/pages/api), so requests stay on this origin */
const apiUrl = (path: string) => `/api${path}`;

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text?.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// Access tokens live 15 minutes; the httpOnly refresh cookie lasts 7 days. Concurrent 401s share one refresh.
let refreshing: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  refreshing ??= fetch(apiUrl("/auth/refresh"), { method: "POST", credentials: "include" })
    .then(async (res) => {
      const data = (await parseBody(res)) as { token?: string };
      if (!res.ok || !data.token) return null;
      useAuthStore.getState().setToken(data.token);
      return data.token;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function endSession() {
  useAuthStore.getState().logout();
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

/** fetch with the bearer token, refreshing it once on 401 */
export async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  // File uploads travel as multipart; the browser sets that Content-Type (with its boundary) itself
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const send = (token: string | null) =>
    fetch(apiUrl(path), {
      ...options,
      headers: {
        ...(!isForm && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
      credentials: "include",
    });

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  let res = await send(token);

  if (res.status === 401 && token) {
    const fresh = await refreshAccessToken();
    if (!fresh) {
      endSession();
      throw new Error("Your session has expired. Please sign in again.");
    }
    res = await send(fresh);
  }
  return res;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, options);
  const data = await parseBody(res);
  if (!res.ok) {
    throw new Error((data as { message?: string })?.message || "Request failed");
  }
  return data as T;
}

/** Downloads a file from an authenticated endpoint (e.g. CSV exports) */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const res = await authedFetch(path);
  if (!res.ok) {
    const data = (await parseBody(res)) as { message?: string };
    throw new Error(data.message || "Download failed");
  }
  const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
