import { expect, test } from "bun:test";
import { authenticatedFetch, resumeAuthentication } from "../src/auth/client";

test("expired saves wait for sign-in and retry their original content", async () => {
  const oldFetch = globalThis.fetch;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  let expired = 0;
  events.addEventListener("flux-session-expired", () => expired++);
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_input, init) => {
    bodies.push(init?.body);
    return new Response(null, { status: bodies.length <= 2 ? 401 : 204 });
  }) as typeof fetch;
  try {
    const first = authenticatedFetch("/note-a", { method: "PUT", body: "unsaved a" });
    const second = authenticatedFetch("/note-b", { method: "PUT", body: "unsaved b" });
    await Promise.resolve();
    expect(expired).toBe(2);
    expect(bodies).toHaveLength(2);
    resumeAuthentication();
    expect((await first).status).toBe(204);
    expect((await second).status).toBe(204);
    expect(bodies).toEqual(["unsaved a", "unsaved b", "unsaved a", "unsaved b"]);
  } finally {
    resumeAuthentication();
    globalThis.fetch = oldFetch;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
