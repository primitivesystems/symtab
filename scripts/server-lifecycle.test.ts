import { test, expect } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

test("production server persists notes/settings across restart and cold backup restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "flux-release-check-"));
  const binary = join(root, "server");
  let child: ChildProcess | undefined;
  let origin = "";
  let cookie = "";
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const timer = setTimeout(() => child?.kill("SIGKILL"), 10_000);
    try {
      expect((await exited)[0]).toBe(0);
    } finally {
      clearTimeout(timer);
    }
  };
  const start = async (data: string) => {
    child = spawn(binary, [], {
      env: {
        PATH: process.env.PATH,
        HOME: root,
        ENVIRONMENT: "production",
        HOST: "127.0.0.1",
        PORT: "0",
        FLUX_APP_DATA_DIR: join(data, "appdata"),
        FLUX_VAULT_ROOT: join(data, "vaults"),
        CORS_ALLOWED_ORIGIN: "https://flux.example",
        FLUX_SETUP_KEY: "release-test-only-setup-key-1234567890",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stderr!.on("data", (chunk) => {
      log += chunk;
    });
    child.stdout!.resume();
    for (let attempt = 0; attempt < 200; attempt++) {
      const address = log.match(/Starting FLUX server on (127\.0\.0\.1:\d+)/)?.[1];
      if (address) {
        origin = `http://${address}`;
        return;
      }
      if (child.exitCode !== null) throw Error(`Startup failed: ${log}`);
      await Bun.sleep(50);
    }
    throw Error("Server startup timed out");
  };
  const request = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${origin}/api/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "https://flux.example",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== status)
      throw Error(
        `${method} ${path}: expected ${status}, got ${response.status}: ${await response.text()}`
      );
    const nextCookie = response.headers.get("set-cookie");
    if (nextCookie) cookie = nextCookie.split(";")[0];
    return status === 204 ? undefined : response.json();
  };
  try {
    const build = spawnSync(
      process.env.GO_BIN ?? "go",
      ["build", "-tags", "sqlite_fts5", "-o", binary, "."],
      {
        cwd: resolve(import.meta.dir, "../server"),
        encoding: "utf8",
      }
    );
    if (build.status !== 0) throw Error(build.stderr);
    const data = join(root, "data");
    await start(data);
    expect((await fetch(`${origin}/api/v1/status`)).status).toBe(401);
    await request(
      "POST",
      "/auth/setup",
      {
        username: "owner",
        password: "release-test-only-password",
        setupKey: "release-test-only-setup-key-1234567890",
      },
      204
    );
    const vault = await request("POST", "/vaults/create", { path: "ReleaseCheck" }, 201);
    await request(
      "POST",
      `/vaults/${vault.id}/files`,
      { path: "Note.md", content: "# Durable note\n" },
      201
    );
    await request("PUT", "/app-settings/theme", { value: "dark" }, 204);
    const forbidden = await fetch(`${origin}/api/v1/app-settings/theme`, {
      method: "PUT",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ value: "light" }),
    });
    expect(forbidden.status).toBe(403);
    const verify = async () => {
      expect(await request("GET", "/auth/status")).toMatchObject({
        authenticated: true,
        setupRequired: false,
        username: "owner",
      });
      const reopened = await request("POST", "/vaults/open", { path: "ReleaseCheck" });
      expect(reopened.id).toBe(vault.id);
      const note = await request("GET", `/vaults/${vault.id}/files/content?path=Note.md`);
      expect(note.content).toBe("# Durable note\n");
      expect(await request("GET", "/app-settings")).toMatchObject({ theme: "dark" });
    };
    await stop();
    await start(data);
    await verify();
    await stop();
    const restored = join(root, "restored");
    await cp(data, restored, { recursive: true });
    await start(restored);
    await verify();
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
