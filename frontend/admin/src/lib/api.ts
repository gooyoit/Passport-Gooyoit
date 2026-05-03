const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export async function request<T>(
  path: string,
  accessToken: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function buildAuthorizeUrl(redirectUri: string) {
  const passportUrl = import.meta.env.VITE_PASSPORT_URL;
  const clientId = import.meta.env.VITE_CLIENT_ID;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
  });
  return `${passportUrl}?${params}`;
}
