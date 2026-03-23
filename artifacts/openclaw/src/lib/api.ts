export function getApiKey(): string | null {
  return localStorage.getItem("openclaw_api_key");
}

export function apiHeaders(extra?: HeadersInit): HeadersInit {
  const key = getApiKey();
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (key) base["X-API-Key"] = key;
  if (extra instanceof Headers) {
    extra.forEach((v, k) => { base[k] = v; });
  } else if (extra) {
    Object.assign(base, extra);
  }
  return base;
}

export function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const key = getApiKey();
  const headers = new Headers(options.headers ?? {});
  if (key && !headers.has("x-api-key")) headers.set("x-api-key", key);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(url, { ...options, headers });
}
