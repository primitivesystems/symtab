import type { PluginCapability } from "@symtab/plugin-sdk";
import type { HostMessage, HostRequest, PluginBundle, WorkerMessage } from "./protocol";

export interface RuntimeWorker {
  postMessage(message: HostMessage): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export interface PluginFailure {
  pluginId: string;
  failures: number;
  reason: string;
}

export interface VaultPluginHostOptions {
  vaultId: string;
  capabilityHandler(
    pluginId: string,
    capability: PluginCapability,
    input: unknown
  ): Promise<unknown>;
  workerFactory?: () => RuntimeWorker;
  operationTimeoutMs?: number;
  maxFailures?: number;
  maxWorkerRestarts?: number;
  onFailure?(failure: PluginFailure): void;
  onDisabled?(failure: PluginFailure): void;
}

interface Pending {
  pluginId: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

type RequestBody = HostRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

function defaultWorker(vaultId: string): RuntimeWorker {
  return new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: `symtab-plugins:${vaultId}`,
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns exactly one isolated plugin Worker for one vault. */
export class VaultPluginHost {
  readonly vaultId: string;
  private readonly options: Required<
    Pick<VaultPluginHostOptions, "operationTimeoutMs" | "maxFailures" | "maxWorkerRestarts">
  > &
    VaultPluginHostOptions;
  private worker: RuntimeWorker;
  private nextRequest = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly bundles = new Map<string, PluginBundle>();
  private readonly failures = new Map<string, number>();
  private readonly disabled = new Set<string>();
  private readonly recordedErrors = new WeakMap<Error, Set<string>>();
  private restarting = false;
  private workerRestarts = 0;
  private stopped = false;
  private disposed = false;

  constructor(options: VaultPluginHostOptions) {
    this.vaultId = options.vaultId;
    this.options = {
      operationTimeoutMs: options.operationTimeoutMs ?? 5_000,
      maxFailures: options.maxFailures ?? 3,
      maxWorkerRestarts: options.maxWorkerRestarts ?? 1,
      ...options,
    };
    this.worker = this.createWorker();
  }

  isDisabled(pluginId: string): boolean {
    return this.disabled.has(pluginId);
  }

  failureCount(pluginId: string): number {
    return this.failures.get(pluginId) ?? 0;
  }

  async activate(plugin: PluginBundle): Promise<void> {
    if (this.disposed) throw new Error("plugin host is disposed");
    if (this.disabled.has(plugin.manifest.id)) throw new Error("plugin is disabled");
    this.bundles.set(plugin.manifest.id, plugin);
    try {
      await this.request(plugin.manifest.id, {
        kind: "activate",
        plugin,
        vaultId: this.vaultId,
      });
      this.failures.delete(plugin.manifest.id);
    } catch (error) {
      this.recordFailure(plugin.manifest.id, error);
      throw error;
    }
  }

  async deactivate(pluginId: string): Promise<void> {
    this.bundles.delete(pluginId);
    if (this.disposed) return;
    await this.request(pluginId, { kind: "deactivate", pluginId });
  }

  async emit(pluginId: string, event: string, payload: unknown): Promise<void> {
    if (this.disabled.has(pluginId)) throw new Error("plugin is disabled");
    try {
      await this.request(pluginId, { kind: "event", pluginId, event, payload });
      this.failures.delete(pluginId);
    } catch (error) {
      this.recordFailure(pluginId, error);
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.rejectPending(new Error("plugin host disposed"));
    this.bundles.clear();
  }

  private createWorker(): RuntimeWorker {
    const worker = this.options?.workerFactory?.() ?? defaultWorker(this.vaultId);
    worker.onmessage = (event) => this.handleMessage(worker, event.data);
    worker.onerror = (event) => this.handleWorkerFailure(worker, event.message || "worker crashed");
    worker.onmessageerror = () => this.handleWorkerFailure(worker, "worker message failed");
    return worker;
  }

  private request(pluginId: string, request: RequestBody): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error("plugin worker is stopped"));
    const id = this.nextRequest++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`plugin operation timed out: ${pluginId}`);
        reject(error);
        this.restartWorker(error);
      }, this.options.operationTimeoutMs);
      this.pending.set(id, { pluginId, resolve, reject, timer });
      try {
        this.worker.postMessage({ id, ...request } as HostRequest);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleMessage(worker: RuntimeWorker, message: WorkerMessage): void {
    if (worker !== this.worker) return;
    if (message.kind === "fatal") {
      const error = new Error(message.error);
      this.recordFailure(message.pluginId, error);
      this.restartWorker(error);
      return;
    }
    if (message.kind === "capability") {
      void this.options
        .capabilityHandler(message.pluginId, message.capability, message.input)
        .then(
          (value) => {
            if (worker === this.worker) {
              try {
                worker.postMessage({ kind: "capability-result", id: message.id, value });
              } catch {
                try {
                  worker.postMessage({
                    kind: "capability-result",
                    id: message.id,
                    error: "capability result is not transferable",
                  });
                } catch (postError) {
                  this.handleWorkerFailure(worker, errorText(postError));
                }
              }
            }
          },
          (error) => {
            if (worker === this.worker) {
              try {
                worker.postMessage({
                  kind: "capability-result",
                  id: message.id,
                  error: error instanceof Error ? error.message : String(error),
                });
              } catch (postError) {
                this.handleWorkerFailure(worker, errorText(postError));
              }
            }
          }
        );
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.value);
  }

  private recordFailure(pluginId: string, error: unknown): void {
    if (!this.bundles.has(pluginId) || this.disabled.has(pluginId)) return;
    if (error instanceof Error) {
      const plugins = this.recordedErrors.get(error) ?? new Set<string>();
      if (plugins.has(pluginId)) return;
      plugins.add(pluginId);
      this.recordedErrors.set(error, plugins);
    }
    const failures = (this.failures.get(pluginId) ?? 0) + 1;
    this.failures.set(pluginId, failures);
    const failure = { pluginId, failures, reason: errorText(error) };
    this.options.onFailure?.(failure);
    if (failures < this.options.maxFailures) return;
    this.disabled.add(pluginId);
    this.bundles.delete(pluginId);
    this.options.onDisabled?.(failure);
    queueMicrotask(() => {
      if (this.disposed || this.restarting || this.stopped) return;
      void this.request(pluginId, { kind: "deactivate", pluginId }).catch(() => undefined);
    });
  }

  private handleWorkerFailure(worker: RuntimeWorker, reason: string): void {
    if (worker !== this.worker || this.disposed || this.restarting) return;
    const error = new Error(reason);
    const affected = new Set([...this.pending.values()].map((item) => item.pluginId));
    for (const pluginId of affected) this.recordFailure(pluginId, error);
    this.restartWorker(error);
  }

  private restartWorker(error: Error): void {
    if (this.disposed || this.restarting) return;
    if (this.workerRestarts >= this.options.maxWorkerRestarts) {
      this.stopped = true;
      this.worker.terminate();
      this.rejectPending(error);
      return;
    }
    this.restarting = true;
    this.workerRestarts += 1;
    this.worker.terminate();
    this.rejectPending(error);
    this.worker = this.createWorker();
    const replacement = this.worker;
    const restore = [...this.bundles.values()].filter(
      (plugin) => !this.disabled.has(plugin.manifest.id)
    );
    this.restarting = false;
    const restorations = restore.map((plugin) =>
      this.request(plugin.manifest.id, {
        kind: "activate",
        plugin,
        vaultId: this.vaultId,
      }).catch((restoreError) => this.recordFailure(plugin.manifest.id, restoreError))
    );
    void Promise.allSettled(restorations).then(() => {
      if (!this.disposed && !this.stopped && this.worker === replacement) this.workerRestarts = 0;
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
