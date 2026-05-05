import { useState, useCallback } from "react";
import { z } from "zod";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export const loginMethodsSchema = z.object({ login_methods: z.array(z.string()) });

export const redirectUriSchema = z.object({
  redirect_uri: z.string().min(1),
});

export function isAllowedRedirect(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
}

export function safeRedirect(url: string) {
  if (isAllowedRedirect(url)) {
    window.location.href = url;
  } else {
    console.error("Blocked redirect to untrusted origin:", url);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    },
    signal,
  });
  clearTimeout(timeout);
  if (!res.ok) {
    const raw = await res.text();
    let msg = raw || res.statusText;
    try {
      const d = JSON.parse(raw);
      if (typeof d.detail === "string") msg = d.detail;
      else if (Array.isArray(d.detail)) msg = d.detail.map((e: { msg: string }) => e.msg).join(", ");
    } catch { /* keep raw */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function useOAuthParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    clientId: p.get("client_id") ?? "",
    redirectUri: p.get("redirect_uri") ?? "",
    state: p.get("state") ?? "",
    appName: p.get("application_name") || "Gooyoit",
  };
}

export function providerUrl(provider: string, o: ReturnType<typeof useOAuthParams>) {
  return `${API_BASE}/oauth/providers/${provider}/authorize?client_id=${encodeURIComponent(o.clientId)}&redirect_uri=${encodeURIComponent(o.redirectUri)}&state=${encodeURIComponent(o.state)}`;
}
