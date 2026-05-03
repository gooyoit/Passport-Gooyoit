import { tokenResponseSchema } from "./schemas";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export async function request<T>(
  path: string,
  accessToken: string | null,
  options: RequestInit = {},
  _retried = false,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
    signal,
  });
  clearTimeout(timeout);
  if (response.status === 401 && !path.includes("token-refresh") && !_retried) {
    const refreshRes = await fetch(`${API_BASE}/token-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      const result = tokenResponseSchema.safeParse(refreshData);
      if (!result.success) {
        throw new Error("Invalid token response");
      }
      window.dispatchEvent(new CustomEvent("token-refreshed", { detail: refreshData }));
      return request<T>(path, refreshData.access_token, options, true);
    }
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const _passportUrl = import.meta.env.VITE_PASSPORT_URL;
const _clientId = import.meta.env.VITE_CLIENT_ID;

export function buildAuthorizeUrl(redirectUri: string) {
  if (!_passportUrl || !_clientId) {
    throw new Error("Missing required env vars: VITE_PASSPORT_URL, VITE_CLIENT_ID");
  }
  const params = new URLSearchParams({
    client_id: _clientId,
    redirect_uri: redirectUri,
    response_type: "code",
  });
  return `${_passportUrl}?${params}`;
}
