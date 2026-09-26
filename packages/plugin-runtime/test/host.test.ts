import { describe, expect, test } from "bun:test";
import type { PluginManifest } from "@symtab/plugin-sdk";
import { VaultPluginHost, type RuntimeWorker } from "../src";
import type { HostMessage, PluginBundle, WorkerMessage } from "../src/protocol";

const manifest: PluginManifest = {
  schemaVersion: 1,
  id: "test.plugin",
  name: "Test",
  version: "1.0.0",
  apiVersion: "1",
  entry: "dist/main.js",
};

const bundle: PluginBundle = {
  manifest,
  source: "__symtabRegisterPlugin({ activate() {} })",
  grantedCapabilities: ["vault.read"],
  settings: {},
};

class FakeWorker implements RuntimeWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  readonly sent: HostMessage[] = [];
  respond = true;
  throwNext = false;

  postMessage(message: HostMessage): void {
    if (this.throwNext) {
      this.throwNext = false;
      throw new DOMException("not cloneable", "DataCloneError");
    }
    this.sent.push(message);
    if (this.respond && "id" in message && message.kind !== "capability-result") {
      queueMicrotask(() => this.result({ kind: "result", id: message.id }));
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  result(message: WorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>);
  }
}

describe("VaultPluginHost", () => {
  test("uses one worker for a vault and proxies capabilities", async () => {
    const worker = new FakeWorker();
    const calls: unknown[] = [];
    const host = new VaultPluginHost({
      vaultId: "vault-1",
      workerFactory: () => worker,
      capabilityHandler: async (...args) => {
        calls.push(args);
        return { content: "ok" };
      },
    });
    await host.activate(bundle);
    worker.result({
      kind: "capability",
      id: 9,
      pluginId: manifest.id,
      capability: "vault.read",
      input: { path: "note.md" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual([[manifest.id, "vault.read", { path: "note.md" }]]);
    expect(worker.sent.at(-1)).toEqual({
      kind: "capability-result",
      id: 9,
      value: { content: "ok" },
    });
    host.dispose();
  });

  test("auto-disables a repeatedly failing plugin", async () => {
    const worker = new FakeWorker();
    const disabled: string[] = [];
    const host = new VaultPluginHost({
      vaultId: "vault-1",
      workerFactory: () => worker,
      capabilityHandler: async () => undefined,
      maxFailures: 2,
      onDisabled: (failure) => disabled.push(failure.pluginId),
    });
    await host.activate(bundle);
    worker.respond = false;
    const failures = [host.emit(manifest.id, "event", null), host.emit(manifest.id, "event", null)];
    const requests = worker.sent.filter(
      (item): item is Extract<HostMessage, { kind: "event" }> => item.kind === "event"
    );
    worker.result({ kind: "result", id: requests[0]!.id, error: "broken" });
    worker.result({ kind: "result", id: requests[1]!.id, error: "broken" });
    await Promise.allSettled(failures);
    expect(host.failureCount(manifest.id)).toBe(2);
    expect(host.isDisabled(manifest.id)).toBe(true);
    expect(disabled).toEqual([manifest.id]);
    host.dispose();
  });

  test("kills a timed-out worker and restores healthy plugins once", async () => {
    const workers: FakeWorker[] = [];
    const host = new VaultPluginHost({
      vaultId: "vault-1",
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      capabilityHandler: async () => undefined,
      operationTimeoutMs: 10,
    });
    await host.activate(bundle);
    workers[0]!.respond = false;
    await expect(host.emit(manifest.id, "hang", null)).rejects.toThrow("timed out");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.sent.some((item) => item.kind === "activate")).toBe(true);
    expect(host.failureCount(manifest.id)).toBe(1);
    host.dispose();
  });

  test("drops capability results from a replaced worker", async () => {
    let resolveCapability: ((value: unknown) => void) | undefined;
    const workers: FakeWorker[] = [];
    const host = new VaultPluginHost({
      vaultId: "vault-1",
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      capabilityHandler: () => new Promise((resolve) => (resolveCapability = resolve)),
      operationTimeoutMs: 10,
    });
    await host.activate(bundle);
    const old = workers[0]!;
    old.result({
      kind: "capability",
      id: 1,
      pluginId: manifest.id,
      capability: "vault.read",
      input: { path: "x" },
    });
    old.respond = false;
    await expect(host.emit(manifest.id, "hang", null)).rejects.toThrow("timed out");
    resolveCapability?.("stale");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workers[1]!.sent).not.toContainEqual({
      kind: "capability-result",
      id: 1,
      value: "stale",
    });
    host.dispose();
  });

  test("counts a worker crash once and rejects its operation", async () => {
    const workers: FakeWorker[] = [];
    const host = new VaultPluginHost({
      vaultId: "vault-1",
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      capabilityHandler: async () => undefined,
    });
    await host.activate(bundle);
    workers[0]!.respond = false;
    const operation = host.emit(manifest.id, "event", null);
    workers[0]!.onerror?.({ message: "crashed" } as ErrorEvent);
    await expect(operation).rejects.toThrow("crashed");
    expect(host.failureCount(manifest.id)).toBe(1);
    host.dispose();
  });

  test("attributes an unhandled rejection to its plugin", async () => {
    const workers: FakeWorker[] = [];
    const host = new VaultPluginHost({
      vaultId: "vault-1",
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      capabilityHandler: async () => undefined,
    });
    await host.activate(bundle);
    workers[0]!.result({ kind: "fatal", pluginId: manifest.id, error: "detached failure" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.failureCount(manifest.id)).toBe(1);
    expect(workers).toHaveLength(2);
    host.dispose();
  });

  test("cleans a request when structured cloning fails synchronously", async () => {
    const worker = new FakeWorker();
    const host = new VaultPluginHost({
      vaultId: "vault-1",
      workerFactory: () => worker,
      capabilityHandler: async () => undefined,
      operationTimeoutMs: 5,
    });
    await host.activate(bundle);
    worker.throwNext = true;
    await expect(host.emit(manifest.id, "event", () => undefined)).rejects.toThrow(
      "not cloneable"
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(worker.terminated).toBe(false);
    host.dispose();
  });
});
