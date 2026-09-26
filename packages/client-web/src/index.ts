import type {
  AgentEvent,
  AgentProvider,
  AgentThread,
  AgentTurn,
  AppBootstrap,
  CreateAgentThreadRequest,
  CreateFileRequest,
  DocumentReferences,
  FileDocument,
  FileEntry,
  FilePage,
  SymtabClient,
  MarketplaceIndex,
  MoveFileRequest,
  OpenVaultRequest,
  PatchFileRequest,
  PluginCatalogEntry,
  PluginInstallResult,
  PurgeResult,
  RecentVault,
  RuntimePluginBundle,
  SaveFileRequest,
  SaveResult,
  SearchResult,
  ServerStatus,
  StartAgentTurnRequest,
  TrashEntry,
  TrashRetentionDays,
  VaultInfo,
  VaultGraph,
  VaultChange,
  VaultLocation,
  VaultFacets,
  WorkspaceSession,
} from "@symtab/bridge-contract";

export class SymtabClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "SymtabClientError";
  }
}

export type SymtabFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class WebSymtabClient implements SymtabClient {
  constructor(
    private readonly baseURL = "/api/v1",
    private readonly fetcher: SymtabFetch = (input, init) => globalThis.fetch(input, init)
  ) {}

  getStatus() {
    return this.request<ServerStatus>("/status");
  }

  getBootstrap(windowId: string) {
    const query = new URLSearchParams({ windowId });
    return this.request<AppBootstrap>(`/bootstrap?${query.toString()}`);
  }

  listRecentVaults() {
    return this.request<RecentVault[]>("/recent-vaults");
  }

  listAvailableVaults() {
    return this.request<VaultLocation[]>("/vaults/available");
  }

  rememberVault(vault: Pick<RecentVault, "vaultId" | "path" | "displayName">) {
    return this.request<void>(`/recent-vaults/${encodeURIComponent(vault.vaultId)}`, {
      method: "PUT",
      body: JSON.stringify({ path: vault.path, displayName: vault.displayName }),
    });
  }

  forgetVault(vaultId: string) {
    return this.request<void>(`/recent-vaults/${encodeURIComponent(vaultId)}`, {
      method: "DELETE",
    });
  }

  async getWorkspace(windowId: string, vaultId?: string) {
    const query = new URLSearchParams();
    if (vaultId) query.set("vaultId", vaultId);
    try {
      return await this.request<WorkspaceSession>(
        `/workspace-sessions/${encodeURIComponent(windowId)}${query.size ? `?${query}` : ""}`
      );
    } catch (error) {
      if (error instanceof SymtabClientError && error.status === 404) return null;
      throw error;
    }
  }

  saveWorkspace(windowId: string, vaultId: string, state: unknown) {
    return this.request<void>(`/workspace-sessions/${encodeURIComponent(windowId)}`, {
      method: "PUT",
      body: JSON.stringify({ vaultId, state }),
    });
  }

  getAppSettings() {
    return this.request<Record<string, unknown>>("/app-settings");
  }

  putAppSetting(key: string, value: unknown) {
    return this.request<void>(`/app-settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  }

  getVaultConfig(vaultId: string) {
    return this.request<Record<string, unknown>>(`/vaults/${encodeURIComponent(vaultId)}/config`);
  }

  putVaultConfig(vaultId: string, value: Record<string, unknown>) {
    return this.request<void>(`/vaults/${encodeURIComponent(vaultId)}/config`, {
      method: "PUT",
      body: JSON.stringify(value),
    });
  }

  listMCPConnections() {
    return this.request<import("@symtab/bridge-contract").MCPConnection[]>("/mcp-connections");
  }

  createMCPConnection(request: {
    name: string;
    mode: import("@symtab/bridge-contract").MCPConnection["mode"];
    vaultIds: string[];
  }) {
    return this.request<import("@symtab/bridge-contract").MCPConnectionCredential>(
      "/mcp-connections",
      { method: "POST", body: JSON.stringify(request) }
    );
  }

  revokeMCPConnection(connectionId: string) {
    return this.request<void>(`/mcp-connections/${encodeURIComponent(connectionId)}`, {
      method: "DELETE",
    });
  }

  listModelProviders() {
    return this.request<import("@symtab/bridge-contract").ModelProvider[]>("/model-providers");
  }

  getModelProvider(providerId: string) {
    return this.request<import("@symtab/bridge-contract").ModelProvider>(
      `/model-providers/${encodeURIComponent(providerId)}`
    );
  }

  updateModelProvider(providerId: string, config: Record<string, unknown>) {
    return this.request<void>(`/model-providers/${encodeURIComponent(providerId)}`, {
      method: "PUT",
      body: JSON.stringify(config),
    });
  }

  listAIRuntimes() {
    return this.request<import("@symtab/bridge-contract").AIRuntime[]>("/ai-runtimes");
  }

  getAIRuntime(runtimeId: string) {
    return this.request<import("@symtab/bridge-contract").AIRuntime>(
      `/ai-runtimes/${encodeURIComponent(runtimeId)}`
    );
  }

  listAgentProviders() {
    return this.request<AgentProvider[]>("/agent/providers");
  }

  createAgentThread(request: CreateAgentThreadRequest) {
    return this.request<AgentThread>("/agent/threads", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  listAgentThreads(vaultId: string) {
    const query = new URLSearchParams({ vaultId });
    return this.request<AgentThread[]>(`/agent/threads?${query}`);
  }

  getAgentThread(threadId: string) {
    return this.request<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}`);
  }

  renameAgentThread(threadId: string, title: string) {
    return this.request<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }

  updateAgentThreadConfiguration(threadId: string, configuration: AgentThread["configuration"]) {
    return this.request<AgentThread>(
      `/agent/threads/${encodeURIComponent(threadId)}/configuration`,
      { method: "PUT", body: JSON.stringify(configuration) }
    );
  }

  listAgentEvents(threadId: string, afterSequence = 0) {
    const query = new URLSearchParams({ after: String(afterSequence) });
    return this.request<AgentEvent[]>(
      `/agent/threads/${encodeURIComponent(threadId)}/events/history?${query}`
    );
  }

  deleteAgentThread(threadId: string) {
    return this.request<void>(`/agent/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
    });
  }

  startAgentTurn(threadId: string, request: StartAgentTurnRequest) {
    return this.request<AgentTurn>(`/agent/threads/${encodeURIComponent(threadId)}/turns`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  interruptAgentTurn(threadId: string, turnId: string) {
    return this.request<void>(
      `/agent/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      { method: "POST" }
    );
  }

  respondAgentApproval(threadId: string, requestId: string, optionId: string) {
    return this.request<void>(
      `/agent/threads/${encodeURIComponent(threadId)}/approvals/${encodeURIComponent(requestId)}`,
      { method: "POST", body: JSON.stringify({ optionId }) }
    );
  }

  watchAgentThread(
    threadId: string,
    onEvent: (event: AgentEvent) => void,
    onError?: (error: Error) => void,
    afterSequence = 0
  ) {
    const query = new URLSearchParams({ after: String(afterSequence) });
    const source = new EventSource(
      `${this.baseURL}/agent/threads/${encodeURIComponent(threadId)}/events?${query}`
    );
    source.addEventListener("agent", (event) => {
      try {
        onEvent(JSON.parse((event as MessageEvent<string>).data) as AgentEvent);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
    source.onerror = () => onError?.(new Error("Agent event stream disconnected"));
    return () => source.close();
  }

  listPlugins() {
    return this.request<PluginCatalogEntry[]>("/plugins");
  }

  getMarketplace() {
    return this.request<MarketplaceIndex>("/marketplace");
  }

  installMarketplacePlugin(pluginId: string) {
    return this.request<PluginInstallResult>(
      `/plugins/marketplace/${encodeURIComponent(pluginId)}/install`,
      { method: "POST" }
    );
  }

  installPlugin(packageData: Uint8Array, sha256: string) {
    let binary = "";
    for (let offset = 0; offset < packageData.length; offset += 0x8000) {
      binary += String.fromCharCode(...packageData.subarray(offset, offset + 0x8000));
    }
    return this.request<PluginInstallResult>("/plugins/install", {
      method: "POST",
      body: JSON.stringify({ packageBase64: btoa(binary), sha256 }),
    });
  }

  activatePlugin(pluginId: string, version: string) {
    return this.request<void>(
      `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}/activate`,
      { method: "POST" }
    );
  }

  approvePluginUpdate(
    vaultId: string,
    pluginId: string,
    version: string,
    grantedPermissions: string[]
  ) {
    return this.request<void>(
      `/vaults/${encodeURIComponent(vaultId)}/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}/approve`,
      { method: "POST", body: JSON.stringify({ grantedPermissions }) }
    );
  }

  rollbackPlugin(pluginId: string) {
    return this.request<void>(`/plugins/${encodeURIComponent(pluginId)}/rollback`, {
      method: "POST",
    });
  }

  uninstallPlugin(pluginId: string, version: string) {
    return this.request<void>(
      `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}`,
      { method: "DELETE" }
    );
  }

  listVaultPlugins(vaultId: string) {
    return this.request<import("@symtab/bridge-contract").VaultPlugin[]>(
      `/vaults/${encodeURIComponent(vaultId)}/plugins`
    );
  }

  enableVaultPlugin(vaultId: string, pluginId: string, grantedPermissions: string[]) {
    return this.request<void>(
      `/vaults/${encodeURIComponent(vaultId)}/plugins/${encodeURIComponent(pluginId)}`,
      { method: "PUT", body: JSON.stringify({ grantedPermissions }) }
    );
  }

  disableVaultPlugin(vaultId: string, pluginId: string) {
    return this.request<void>(
      `/vaults/${encodeURIComponent(vaultId)}/plugins/${encodeURIComponent(pluginId)}`,
      { method: "DELETE" }
    );
  }

  listPluginBundles(vaultId: string) {
    return this.request<RuntimePluginBundle[]>(
      `/vaults/${encodeURIComponent(vaultId)}/plugin-bundles`
    );
  }

  invokePluginCapability(vaultId: string, pluginId: string, capability: string, input: unknown) {
    return this.request<unknown>(
      `/vaults/${encodeURIComponent(vaultId)}/plugins/${encodeURIComponent(pluginId)}/capabilities/${encodeURIComponent(capability)}`,
      { method: "POST", body: JSON.stringify({ input }) }
    );
  }

  getPluginView(vaultId: string, pluginId: string, viewId: string) {
    return this.request<{ id: string; title: string; html: string }>(
      `/vaults/${encodeURIComponent(vaultId)}/plugins/${encodeURIComponent(pluginId)}/views/${encodeURIComponent(viewId)}`
    );
  }

  async getPluginSettings(vaultId: string, pluginId: string) {
    const result = await this.request<{ values: Record<string, unknown> }>(
      `/vaults/${encodeURIComponent(vaultId)}/plugins/${encodeURIComponent(pluginId)}/settings`
    );
    return result.values;
  }

  putPluginSettings(vaultId: string, pluginId: string, values: Record<string, unknown>) {
    return this.request<void>(
      `/vaults/${encodeURIComponent(vaultId)}/plugins/${encodeURIComponent(pluginId)}/settings`,
      { method: "PUT", body: JSON.stringify({ values }) }
    );
  }

  openVault(request: OpenVaultRequest = {}) {
    return this.request<VaultInfo>("/vaults/open", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  getVaultInfo(vaultId: string) {
    return this.request<VaultInfo>(`/vaults/${encodeURIComponent(vaultId)}`);
  }

  createVault(request: Required<OpenVaultRequest>) {
    return this.request<VaultInfo>("/vaults/create", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async getVaultRevision(vaultId: string) {
    const result = await this.request<{ revision: number }>(
      `/vaults/${encodeURIComponent(vaultId)}/revision`
    );
    return result.revision;
  }

  watchVaultRevision(
    vaultId: string,
    onRevision: (revision: number) => void,
    onError?: (error: Error) => void
  ) {
    return this.watchVaultChanges(vaultId, (change) => onRevision(change.revision), onError);
  }

  watchVaultChanges(
    vaultId: string,
    onChange: (change: VaultChange) => void,
    onError?: (error: Error) => void
  ) {
    const source = new EventSource(`${this.baseURL}/vaults/${encodeURIComponent(vaultId)}/events`);
    source.addEventListener("revision", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as VaultChange;
        if (typeof payload.revision === "number") onChange(payload);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
    source.onerror = () => onError?.(new Error("Vault event stream disconnected"));
    return () => source.close();
  }

  listFiles(vaultId: string) {
    return this.request<FileEntry[]>(`/vaults/${encodeURIComponent(vaultId)}/files`);
  }

  listFileChildren(vaultId: string, parent: string, cursor?: string) {
    const query = new URLSearchParams({ parent, limit: "250" });
    if (cursor) query.set("cursor", cursor);
    return this.request<FilePage>(
      `/vaults/${encodeURIComponent(vaultId)}/files/children?${query.toString()}`
    );
  }

  getGraph(vaultId: string) {
    return this.request<VaultGraph>(`/vaults/${encodeURIComponent(vaultId)}/graph`);
  }

  searchVault(vaultId: string, query: string, limit = 100, offset = 0, matchCase = false) {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      offset: String(offset),
      matchCase: String(matchCase),
    });
    return this.request<SearchResult[]>(
      `/vaults/${encodeURIComponent(vaultId)}/search?${params.toString()}`
    );
  }

  getDocumentReferences(vaultId: string, path: string, includeUnlinked = false) {
    const params = new URLSearchParams({ path });
    if (includeUnlinked) params.set("includeUnlinked", "true");
    return this.request<DocumentReferences>(
      `/vaults/${encodeURIComponent(vaultId)}/references?${params.toString()}`
    );
  }

  getVaultFacets(vaultId: string) {
    return this.request<VaultFacets>(`/vaults/${encodeURIComponent(vaultId)}/facets`);
  }

  async getFileMetadata(vaultId: string, path: string) {
    const query = new URLSearchParams({ path });
    try {
      return await this.request<FileEntry>(
        `/vaults/${encodeURIComponent(vaultId)}/files/metadata?${query.toString()}`
      );
    } catch (error) {
      if (error instanceof SymtabClientError && error.status === 404) return null;
      throw error;
    }
  }

  rebuildIndex(vaultId: string) {
    return this.request<void>(`/vaults/${encodeURIComponent(vaultId)}/index/rebuild`, {
      method: "POST",
    });
  }

  createDirectory(vaultId: string, path: string) {
    return this.request<FileEntry>(`/vaults/${encodeURIComponent(vaultId)}/directories`, {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  }

  createFile(request: CreateFileRequest) {
    const { vaultId, ...body } = request;
    return this.request<FileDocument>(`/vaults/${encodeURIComponent(vaultId)}/files`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  readFile(vaultId: string, path: string) {
    const query = new URLSearchParams({ path });
    return this.request<FileDocument>(
      `/vaults/${encodeURIComponent(vaultId)}/files/content?${query.toString()}`
    );
  }

  async readBinaryFile(vaultId: string, path: string) {
    const query = new URLSearchParams({ path });
    const response = await this.fetcher(
      `${this.baseURL}/vaults/${encodeURIComponent(vaultId)}/files/raw?${query.toString()}`
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      throw new SymtabClientError(
        body?.error ?? `Symtab request failed with status ${response.status}`,
        response.status,
        body?.code
      );
    }
    return response.arrayBuffer();
  }

  saveFile(request: SaveFileRequest) {
    const { vaultId, ...body } = request;
    return this.request<SaveResult>(`/vaults/${encodeURIComponent(vaultId)}/files/content`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  patchFile(request: PatchFileRequest) {
    const { vaultId, ...body } = request;
    return this.request<SaveResult>(`/vaults/${encodeURIComponent(vaultId)}/files/content`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  moveFile(request: MoveFileRequest) {
    const { vaultId, ...body } = request;
    return this.request<FileEntry>(`/vaults/${encodeURIComponent(vaultId)}/files/move`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  deleteFile(vaultId: string, path: string) {
    const query = new URLSearchParams({ path });
    return this.request<TrashEntry>(
      `/vaults/${encodeURIComponent(vaultId)}/files?${query.toString()}`,
      { method: "DELETE" }
    );
  }

  restoreFile(vaultId: string, trashId: string) {
    return this.request<FileEntry>(`/vaults/${encodeURIComponent(vaultId)}/files/restore`, {
      method: "POST",
      body: JSON.stringify({ trashId }),
    });
  }

  listTrash(vaultId: string) {
    return this.request<TrashEntry[]>(`/vaults/${encodeURIComponent(vaultId)}/trash`);
  }

  permanentlyDelete(vaultId: string, trashId: string) {
    return this.request<void>(
      `/vaults/${encodeURIComponent(vaultId)}/trash/${encodeURIComponent(trashId)}?confirm=true`,
      { method: "DELETE" }
    );
  }

  purgeTrash(vaultId: string, retentionDays: TrashRetentionDays) {
    const query = new URLSearchParams({
      olderThanDays: String(retentionDays),
      confirm: "true",
    });
    return this.request<PurgeResult>(
      `/vaults/${encodeURIComponent(vaultId)}/trash?${query.toString()}`,
      { method: "DELETE" }
    );
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    return this.requestURL<T>(`${this.baseURL}${path}`, init);
  }

  private async requestURL<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      throw new SymtabClientError(
        body?.error ?? `Symtab request failed with status ${response.status}`,
        response.status,
        body?.code
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
