export type VaultState =
  "closed" | "initializing" | "read_only_ready" | "writable" | "indexing" | "active" | "degraded";

export interface IndexingProgress {
  phase: string;
  processed: number;
  total: number;
  failed: number;
}

export interface VaultFileEvent {
  path: string;
  op: "create" | "write" | "remove" | "reconcile";
}

export interface VaultChange {
  revision: number;
  events?: VaultFileEvent[];
  reconcile?: boolean;
  vault: VaultInfo;
}

export interface ServerStatus {
  status: "healthy" | "degraded";
  version: string;
  vaultConfigured: boolean;
  openVault: VaultInfo | null;
}

export interface OpenVaultRequest {
  path?: string;
}

export interface VaultInfo {
  id: string;
  name: string;
  state: VaultState;
  indexing?: IndexingProgress;
}

export interface RecentVault {
  vaultId: string;
  path: string;
  displayName: string;
  lastOpenedAt: string;
}

export interface VaultLocation {
  vaultId?: string;
  name: string;
  path: string;
}

export interface WorkspaceSession {
  windowId: string;
  vaultId: string;
  state: unknown;
  updatedAt: string;
}

export interface AppBootstrap {
  recentVaults: RecentVault[];
  workspace: WorkspaceSession | null;
  settings: Record<string, unknown>;
}

export interface MCPConnection {
  id: string;
  name: string;
  mode: "read_only" | "guided_write" | "trusted_workspace";
  vaultIds: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface MCPConnectionCredential extends MCPConnection {
  secret: string;
}

export interface FileEntry {
  path: string;
  name: string;
  kind: "directory" | "markdown" | "text" | "binary";
  sizeBytes: number;
  modifiedAt: string;
}

export interface FilePage {
  entries: FileEntry[];
  nextCursor?: string;
}

export interface CreateFileRequest {
  vaultId: string;
  path: string;
  content?: string;
}

export interface FileDocument {
  path: string;
  content: string;
  contentHash: string;
  modifiedAt: string;
}

export interface GraphNode {
  id: string;
  path?: string;
  label: string;
  kind: FileEntry["kind"] | "missing";
  tags?: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface VaultGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SearchResult {
  path: string;
  title: string;
  excerpt: string;
}

export interface DocumentReference {
  source: string;
  line: number;
  excerpt: string;
}

export interface DocumentReferences {
  linked: DocumentReference[];
  unlinked: DocumentReference[];
  outgoing: string[];
}

export interface FacetCount {
  name: string;
  count: number;
}

export interface VaultFacets {
  tags: FacetCount[];
  properties: FacetCount[];
}

export interface SaveFileRequest {
  vaultId: string;
  path: string;
  content: string;
  expectedHash?: string;
}

export interface SaveResult {
  path: string;
  contentHash: string;
  modifiedAt: string;
}

export interface TextEdit {
  startByte: number;
  endByte: number;
  text: string;
}

export interface PatchFileRequest {
  vaultId: string;
  path: string;
  expectedHash: string;
  edits: TextEdit[];
}

export interface MoveFileRequest {
  vaultId: string;
  sourcePath: string;
  destinationPath: string;
}

export interface TrashEntry {
  id: string;
  originalPath: string;
  deletedAt: string;
  sizeBytes: number;
}

export type TrashRetentionDays = 7 | 30 | 90;

export interface PurgeResult {
  deleted: number;
}

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  publisher?: string;
  version: string;
  apiVersion: string;
  entry: string;
  requiredPermissions?: string[];
  optionalPermissions?: string[];
  activationEvents?: string[];
  contributes?: {
    commands?: Array<{ id: string; title: string }>;
    views?: Array<{
      id: string;
      title: string;
      entry: string;
      /** Defaults to modal when omitted. */
      location?: "modal" | "left-sidebar" | "right-sidebar" | "workspace";
      icon?:
        | "puzzle"
        | "sparkles"
        | "panel-left"
        | "panel-right"
        | "layout-dashboard"
        | "calendar"
        | "list"
        | "git-branch";
      iconPath?: string;
    }>;
    settings?: Array<{
      id: string;
      title: string;
      description?: string;
      type: "string" | "number" | "boolean";
      default?: unknown;
    }>;
  };
}

export interface InstalledPlugin {
  pluginId: string;
  version: string;
  checksum: string;
  installPath: string;
  development: boolean;
  status: "staged" | "active" | "previous" | "failed" | "removing";
  installedAt: string;
  activatedAt?: string;
  failureReason?: string;
}

export interface PluginCatalogEntry {
  manifest: PluginManifest;
  plugin: InstalledPlugin;
  active: boolean;
  viewIcons?: Record<string, string>;
}

export interface PluginInstallResult {
  manifest: PluginManifest;
  plugin: InstalledPlugin;
}

export interface VaultPlugin {
  vaultId: string;
  pluginId: string;
  enabled: boolean;
  grantedPermissions: string[];
  updatedAt: string;
  failureCount: number;
  lastError?: string;
}

export interface RuntimePluginBundle {
  manifest: PluginManifest;
  source: string;
  grantedCapabilities: string[];
  settings: Record<string, unknown>;
}

export interface MarketplacePlugin {
  manifest: PluginManifest;
  publisher: string;
  repository: string;
  downloadUrl: string;
  sha256: string;
  readme?: string;
  changelog?: string;
  publishedAt: string;
}

export interface MarketplaceIndex {
  schemaVersion: 1;
  updatedAt: string;
  plugins: MarketplacePlugin[];
}

/** Transport-neutral boundary consumed by application features. */
export interface SymtabClient {
  getStatus(): Promise<ServerStatus>;
  getBootstrap(windowId: string): Promise<AppBootstrap>;
  listRecentVaults(): Promise<RecentVault[]>;
  listAvailableVaults(): Promise<VaultLocation[]>;
  rememberVault(vault: Pick<RecentVault, "vaultId" | "path" | "displayName">): Promise<void>;
  forgetVault(vaultId: string): Promise<void>;
  getWorkspace(windowId: string, vaultId?: string): Promise<WorkspaceSession | null>;
  saveWorkspace(windowId: string, vaultId: string, state: unknown): Promise<void>;
  getAppSettings(): Promise<Record<string, unknown>>;
  putAppSetting(key: string, value: unknown): Promise<void>;
  getVaultConfig(vaultId: string): Promise<Record<string, unknown>>;
  putVaultConfig(vaultId: string, value: Record<string, unknown>): Promise<void>;
  listMCPConnections(): Promise<MCPConnection[]>;
  createMCPConnection(request: {
    name: string;
    mode: MCPConnection["mode"];
    vaultIds: string[];
  }): Promise<MCPConnectionCredential>;
  revokeMCPConnection(connectionId: string): Promise<void>;
  listPlugins(): Promise<PluginCatalogEntry[]>;
  getMarketplace(): Promise<MarketplaceIndex>;
  installMarketplacePlugin(pluginId: string): Promise<PluginInstallResult>;
  installPlugin(packageData: Uint8Array, sha256: string): Promise<PluginInstallResult>;
  activatePlugin(pluginId: string, version: string): Promise<void>;
  approvePluginUpdate(
    vaultId: string,
    pluginId: string,
    version: string,
    grantedPermissions: string[]
  ): Promise<void>;
  rollbackPlugin(pluginId: string): Promise<void>;
  uninstallPlugin(pluginId: string, version: string): Promise<void>;
  listVaultPlugins(vaultId: string): Promise<VaultPlugin[]>;
  enableVaultPlugin(vaultId: string, pluginId: string, grantedPermissions: string[]): Promise<void>;
  disableVaultPlugin(vaultId: string, pluginId: string): Promise<void>;
  listPluginBundles(vaultId: string): Promise<RuntimePluginBundle[]>;
  invokePluginCapability(
    vaultId: string,
    pluginId: string,
    capability: string,
    input: unknown
  ): Promise<unknown>;
  getPluginView(
    vaultId: string,
    pluginId: string,
    viewId: string
  ): Promise<{ id: string; title: string; html: string }>;
  getPluginSettings(vaultId: string, pluginId: string): Promise<Record<string, unknown>>;
  putPluginSettings(
    vaultId: string,
    pluginId: string,
    values: Record<string, unknown>
  ): Promise<void>;
  openVault(request?: OpenVaultRequest): Promise<VaultInfo>;
  getVaultInfo(vaultId: string): Promise<VaultInfo>;
  createVault(request: Required<OpenVaultRequest>): Promise<VaultInfo>;
  getVaultRevision(vaultId: string): Promise<number>;
  watchVaultRevision(
    vaultId: string,
    onRevision: (revision: number) => void,
    onError?: (error: Error) => void
  ): () => void;
  watchVaultChanges(
    vaultId: string,
    onChange: (change: VaultChange) => void,
    onError?: (error: Error) => void
  ): () => void;
  listFiles(vaultId: string): Promise<FileEntry[]>;
  listFileChildren(vaultId: string, parent: string, cursor?: string): Promise<FilePage>;
  getGraph(vaultId: string): Promise<VaultGraph>;
  searchVault(
    vaultId: string,
    query: string,
    limit?: number,
    offset?: number,
    matchCase?: boolean
  ): Promise<SearchResult[]>;
  getDocumentReferences(
    vaultId: string,
    path: string,
    includeUnlinked?: boolean
  ): Promise<DocumentReferences>;
  getVaultFacets(vaultId: string): Promise<VaultFacets>;
  getFileMetadata(vaultId: string, path: string): Promise<FileEntry | null>;
  rebuildIndex(vaultId: string): Promise<void>;
  createDirectory(vaultId: string, path: string): Promise<FileEntry>;
  createFile(request: CreateFileRequest): Promise<FileDocument>;
  readFile(vaultId: string, path: string): Promise<FileDocument>;
  readBinaryFile(vaultId: string, path: string): Promise<ArrayBuffer>;
  saveFile(request: SaveFileRequest): Promise<SaveResult>;
  patchFile(request: PatchFileRequest): Promise<SaveResult>;
  moveFile(request: MoveFileRequest): Promise<FileEntry>;
  deleteFile(vaultId: string, path: string): Promise<TrashEntry>;
  restoreFile(vaultId: string, trashId: string): Promise<FileEntry>;
  listTrash(vaultId: string): Promise<TrashEntry[]>;
  permanentlyDelete(vaultId: string, trashId: string): Promise<void>;
  purgeTrash(vaultId: string, retentionDays: TrashRetentionDays): Promise<PurgeResult>;
  listModelProviders(): Promise<ModelProvider[]>;
  getModelProvider(providerId: string): Promise<ModelProvider>;
  updateModelProvider(providerId: string, config: Record<string, unknown>): Promise<void>;
  listAIRuntimes(): Promise<AIRuntime[]>;
  getAIRuntime(runtimeId: string): Promise<AIRuntime>;
  listAgentProviders(): Promise<import("./agent").AgentProvider[]>;
  createAgentThread(
    request: import("./agent").CreateAgentThreadRequest
  ): Promise<import("./agent").AgentThread>;
  listAgentThreads(vaultId: string): Promise<import("./agent").AgentThread[]>;
  getAgentThread(threadId: string): Promise<import("./agent").AgentThread>;
  renameAgentThread(threadId: string, title: string): Promise<import("./agent").AgentThread>;
  updateAgentThreadConfiguration(
    threadId: string,
    configuration: import("./agent").AgentConfiguration
  ): Promise<import("./agent").AgentThread>;
  listAgentEvents(
    threadId: string,
    afterSequence?: number
  ): Promise<import("./agent").AgentEvent[]>;
  deleteAgentThread(threadId: string): Promise<void>;
  startAgentTurn(
    threadId: string,
    request: import("./agent").StartAgentTurnRequest
  ): Promise<import("./agent").AgentTurn>;
  interruptAgentTurn(threadId: string, turnId: string): Promise<void>;
  respondAgentApproval(
    threadId: string,
    requestId: string,
    optionId: string
  ): Promise<void>;
  watchAgentThread(
    threadId: string,
    onEvent: (event: import("./agent").AgentEvent) => void,
    onError?: (error: Error) => void,
    afterSequence?: number
  ): () => void;
}

export interface RuntimeCapabilities {
  supportsNativeMenus: boolean;
  supportsFileAccess: boolean;
  supportsRemoteVaults: boolean;
  isDesktop: boolean;
  isWeb: boolean;
}

export type ModelProviderType =
  | "codex"
  | "copilot"
  | "opencode"
  | "antigravity"
  | "ollama"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "custom";

export interface ModelProvider {
  id: string;
  type: ModelProviderType;
  name: string;
  description?: string;
  enabled: boolean;
  available: boolean;
  models?: string[];
  config: Record<string, unknown>;
  capabilities: string[];
}

export interface AIRuntimeCapabilities {
  chat: boolean;
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  pdfInput: boolean;
  embeddings: boolean;
  structuredOutput: boolean;
  reasoningControls: boolean;
  contextCaching: boolean;
  externalAgentLoop: boolean;
}

export interface AIRuntime {
  id: string;
  providerId: string;
  name: string;
  model?: string;
  capabilities: AIRuntimeCapabilities;
  config: Record<string, unknown>;
}
export * from "./agent";
