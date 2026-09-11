export type AuthStatus = {
  enabled: boolean;
  setupRequired?: boolean;
  authenticated?: boolean;
  username?: string;
  sessionId?: string;
};
export type Credential = {
  id: string;
  kind: "session" | "api";
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
};

export async function authRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/auth${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401 && !["/login", "/setup", "/password"].includes(path))
      window.dispatchEvent(new Event("flux-session-expired"));
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

let pendingLogin: Promise<void> | undefined;
let resume: (() => void) | undefined;
export function resumeAuthentication() {
  resume?.();
  resume = undefined;
  pendingLogin = undefined;
}

// Keep failed saves pending in memory during reauthentication, not in browser storage.
export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status !== 401) return response;
  if (!pendingLogin)
    pendingLogin = new Promise<void>((resolve) => {
      resume = resolve;
    });
  window.dispatchEvent(new Event("flux-session-expired"));
  await pendingLogin;
  return fetch(input, init);
}
