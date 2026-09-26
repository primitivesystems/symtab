import { useEffect, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@symtab/shared-ui/components/ui/dialog";
import {
  Blocks,
  CalendarDays,
  ChevronDown,
  KeyRound,
  Paintbrush,
  Pencil,
  Plug,
  Plus,
  Search,
  Settings,
  Shield,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type {
  SymtabClient,
  MCPConnection,
  MCPConnectionCredential,
  RecentVault,
} from "@symtab/bridge-contract";
import { useTheme } from "@symtab/shared-ui/components/theme-provider";
import {
  useSymtabSettings,
  type KeychainEntry,
  type GeneralSettings,
  type EditorSettings,
  type AppearanceSettings,
} from "./settings-store";

type SettingsPage =
  | "general"
  | "editor"
  | "appearance"
  | "keychain"
  | "daily-notes"
  | "mcp"
  | "core-plugins"
  | "community-plugins";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPlugins: () => void;
  vaultName?: string;
  client?: SymtabClient | null;
  vaults?: RecentVault[];
  vaultId?: string;
  onVaultConfigChange?: () => void;
  getMCPServerCommand?: () => Promise<{ command: string; args: string[] }>;
  onMenuBarIconChange?: (enabled: boolean) => void;
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingDivider() {
  return <div className="h-px bg-[var(--layout-separator)]" />;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        checked ? "bg-primary" : "bg-[#d4d4d8] dark:bg-[#484848]"
      }`}
    >
      <span
        className={`pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm transition-all duration-200 ${
          checked ? "translate-x-[1.125rem]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function SelectControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border bg-background/60 py-1 pl-3 pr-7 text-xs text-foreground [border-color:var(--layout-separator)] outline-none focus:ring-1 focus:ring-ring/50 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-popover text-popover-foreground">
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 rounded-md border bg-background px-2 py-1.5 text-right text-sm text-foreground [border-color:var(--layout-separator)] focus:outline-none focus:ring-1 focus:ring-ring/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Navigation sidebar                                                 */
/* ------------------------------------------------------------------ */

const navItems: Array<{
  id: SettingsPage;
  label: string;
  icon: typeof Settings;
  section?: string;
}> = [
  { id: "general", label: "General", icon: Settings, section: "Options" },
  { id: "editor", label: "Editor", icon: Pencil },
  { id: "appearance", label: "Appearance", icon: Paintbrush },
  { id: "keychain", label: "Keychain", icon: KeyRound },
  { id: "daily-notes", label: "Daily Notes", icon: CalendarDays },
  { id: "mcp", label: "MCP Connections", icon: Terminal },
  { id: "core-plugins", label: "Core Plugins", icon: Plug, section: "Plugins" },
  { id: "community-plugins", label: "Community Plugins", icon: Blocks },
];

function SettingsNav({
  activePage,
  onSelect,
}: {
  activePage: SettingsPage;
  onSelect: (page: SettingsPage) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Settings navigation">
      {navItems.map((item, index) => {
        const Icon = item.icon;
        const showSection =
          item.section !== undefined && item.section !== navItems[index - 1]?.section;
        return (
          <div key={item.id}>
            {showSection ? (
              <div className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 first:mt-0">
                {item.section}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                activePage === item.id
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.8} />
              <span className="truncate">{item.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  General page                                                       */
/* ------------------------------------------------------------------ */

interface GeneralPageProps {
  vaultName: string;
  onMenuBarIconChange?: (enabled: boolean) => void;
}

function GeneralPage({ vaultName, onMenuBarIconChange }: GeneralPageProps) {
  const { settings, updateSettings } = useSymtabSettings();
  const gen = settings.general;

  const updateGeneral = (field: keyof GeneralSettings, value: any) => {
    updateSettings((prev) => ({
      ...prev,
      general: { ...prev.general, [field]: value },
    }));
  };

  return (
    <div>
      <div>
        <SettingRow label="Vault name" description="The name of your currently active vault.">
          <span className="rounded-md border bg-background/60 px-2.5 py-1 text-xs text-foreground [border-color:var(--layout-separator)]">
            {vaultName || "Symtab Vault"}
          </span>
        </SettingRow>
        {onMenuBarIconChange ? (
          <>
            <SettingDivider />
            <SettingRow
              label="Show in menu bar"
              description="Launch Symtab in background at login and keep quick actions available with no window open."
            >
              <Toggle
                checked={gen.showMenuBarIcon}
                onChange={(enabled) => {
                  updateGeneral("showMenuBarIcon", enabled);
                  onMenuBarIconChange(enabled);
                }}
                label="Show Symtab in menu bar"
              />
            </SettingRow>
          </>
        ) : null}
        <SettingDivider />

        <SettingRow label="Launch behaviour" description="Choose what Symtab opens when launching.">
          <SelectControl
            value={gen.launchBehaviour}
            onChange={(val) => updateGeneral("launchBehaviour", val)}
            options={[
              { value: "last-vault", label: "Open last used vault" },
              { value: "vault-picker", label: "Show vault picker" },
              { value: "empty", label: "Open empty workspace" },
            ]}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow
          label="Default startup page"
          description="Initial view when launching your vault workspace."
        >
          <SelectControl
            value={gen.defaultStartupPage}
            onChange={(val) => updateGeneral("defaultStartupPage", val)}
            options={[
              { value: "last-active", label: "Last active note" },
              { value: "files", label: "File explorer" },
              { value: "graph", label: "Graph view" },
            ]}
          />
        </SettingRow>
        <SettingDivider />

        <SettingRow
          label="Confirm before deleting notes"
          description="Ask for confirmation before permanently deleting notes or moving them to trash."
        >
          <Toggle
            checked={gen.confirmDeleteNote}
            onChange={(val) => updateGeneral("confirmDeleteNote", val)}
            label="Confirm before deleting notes"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow
          label="Auto save"
          description="Automatically write changes to disk after typing."
        >
          <Toggle
            checked={gen.autoSave}
            onChange={(val) => updateGeneral("autoSave", val)}
            label="Auto save"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow
          label="Auto save delay"
          description="Idle time to wait after typing before saving files."
        >
          <SelectControl
            value={String(gen.autoSaveDelay)}
            onChange={(val) => updateGeneral("autoSaveDelay", Number(val))}
            options={[
              { value: "1", label: "1 second" },
              { value: "3", label: "3 seconds" },
              { value: "5", label: "5 seconds" },
              { value: "10", label: "10 seconds" },
            ]}
          />
        </SettingRow>
        <SettingDivider />

        <SettingRow
          label="Show inline title"
          description="Display the note title inside the editor top banner."
        >
          <Toggle
            checked={gen.showInlineTitle}
            onChange={(val) => updateGeneral("showInlineTitle", val)}
            label="Show inline title"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow
          label="Show tab bar"
          description="Display open file tabs at the top of the editor workspace."
        >
          <Toggle
            checked={gen.showTabBar}
            onChange={(val) => updateGeneral("showTabBar", val)}
            label="Show tab bar"
          />
        </SettingRow>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editor page                                                        */
/* ------------------------------------------------------------------ */

function EditorPage() {
  const { settings, updateSettings } = useSymtabSettings();
  const ed = settings.editor;

  const updateEd = (field: keyof EditorSettings, value: any) => {
    updateSettings((prev) => ({
      ...prev,
      editor: { ...prev.editor, [field]: value },
    }));
  };

  return (
    <div>
      <div>
        <SettingRow
          label="Live Preview"
          description="Render Markdown syntax live in the editor while typing."
        >
          <Toggle
            checked={ed.livePreview}
            onChange={(val) => {
              updateEd("livePreview", val);
              // Also sync plugin toggle for live preview
              updateSettings((prev) => ({
                ...prev,
                plugins: { ...prev.plugins, "live-preview": val },
              }));
            }}
            label="Live Preview"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow
          label="Auto Pair Brackets"
          description="Automatically insert matching closing brackets, quotes, and wikilink brackets."
        >
          <Toggle
            checked={ed.autoPairBrackets}
            onChange={(val) => updateEd("autoPairBrackets", val)}
            label="Auto Pair Brackets"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow
          label="Vim key bindings"
          description="Enable Vim modal editing keybindings in CodeMirror."
        >
          <Toggle
            checked={ed.vimBindings}
            onChange={(val) => updateEd("vimBindings", val)}
            label="Vim key bindings"
          />
        </SettingRow>

        <SettingDivider />
        <SettingRow
          label="Word Wrap"
          description="Wrap long lines to fit within the editor viewport."
        >
          <Toggle
            checked={ed.wordWrap}
            onChange={(val) => updateEd("wordWrap", val)}
            label="Word Wrap"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow label="Line Numbers" description="Show line numbers in the editor gutter.">
          <Toggle
            checked={ed.lineNumbers}
            onChange={(val) => updateEd("lineNumbers", val)}
            label="Line Numbers"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow label="Spell Check" description="Enable browser spell checking on editor text.">
          <Toggle
            checked={ed.spellCheck}
            onChange={(val) => updateEd("spellCheck", val)}
            label="Spell Check"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow
          label="Default font size"
          description="Base font size for editor text in pixels."
        >
          <NumberInput
            value={ed.fontSize}
            onChange={(val) => updateEd("fontSize", val)}
            min={12}
            max={32}
            suffix="px"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow label="Tab size" description="Number of spaces per tab indentation.">
          <SelectControl
            value={String(ed.tabSize)}
            onChange={(val) => updateEd("tabSize", Number(val))}
            options={[
              { value: "2", label: "2 spaces" },
              { value: "4", label: "4 spaces" },
              { value: "8", label: "8 spaces" },
            ]}
          />
        </SettingRow>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Appearance page                                                    */
/* ------------------------------------------------------------------ */

function AppearancePage() {
  const { theme, setTheme } = useTheme();
  const { settings, updateSettings } = useSymtabSettings();
  const app = settings.appearance;

  const updateApp = (field: keyof AppearanceSettings, value: any) => {
    updateSettings((prev) => ({
      ...prev,
      appearance: { ...prev.appearance, [field]: value },
    }));
  };

  return (
    <div>
      <div>
        <SettingRow label="Base colour scheme" description="Choose Symtab's default colour scheme.">
          <SelectControl
            value={theme}
            onChange={(val) => {
              const mode = val as "light" | "dark" | "system";
              setTheme(mode);
              updateApp("theme", mode);
            }}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "Adapt to system" },
            ]}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow
          label="Accent colour"
          description="Choose the accent colour used throughout the app."
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateApp("accentColor", "default")}
              className="rounded-md border bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [border-color:var(--layout-separator)]"
            >
              Default
            </button>
            <label className="relative flex cursor-pointer items-center justify-center">
              <input
                type="color"
                value={
                  app.accentColor && app.accentColor !== "default" ? app.accentColor : "#18181b"
                }
                onChange={(e) => updateApp("accentColor", e.target.value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
              <span
                className={`size-6 rounded-full border-2 border-white/20 shadow-sm transition-transform hover:scale-110 ${
                  !app.accentColor || app.accentColor === "default" ? "bg-primary" : ""
                }`}
                style={
                  app.accentColor && app.accentColor !== "default"
                    ? { backgroundColor: app.accentColor }
                    : undefined
                }
              />
            </label>
          </div>
        </SettingRow>

        <SettingDivider />
        <SettingRow
          label="Sidebar density"
          description="Spacing and padding for sidebar navigation lists."
        >
          <SelectControl
            value={app.sidebarDensity}
            onChange={(val) => updateApp("sidebarDensity", val)}
            options={[
              { value: "compact", label: "Compact" },
              { value: "comfortable", label: "Comfortable" },
              { value: "spacious", label: "Spacious" },
            ]}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow
          label="Font scaling"
          description="Scale text size across the entire Symtab user interface."
        >
          <SelectControl
            value={String(app.fontScaling)}
            onChange={(val) => updateApp("fontScaling", Number(val))}
            options={[
              { value: "90", label: "90% (Small)" },
              { value: "100", label: "100% (Normal)" },
              { value: "110", label: "110% (Large)" },
              { value: "125", label: "125% (Extra Large)" },
            ]}
          />
        </SettingRow>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Keychain page                                                      */
/* ------------------------------------------------------------------ */

function KeychainPage() {
  const { settings, updateSettings } = useSymtabSettings();
  const keychain = settings.keychain;

  const [newServiceName, setNewServiceName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAddKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServiceName.trim()) return;

    const masked = newKeyValue.trim()
      ? `${newKeyValue.trim().slice(0, 7)}••••••••${newKeyValue.trim().slice(-4)}`
      : "";

    const entry: KeychainEntry = {
      id: `key-${Date.now()}`,
      name: newServiceName.trim(),
      service: newServiceName.trim().toLowerCase().replace(/\s+/g, "-"),
      key: masked || "sk-configured",
      status: masked ? "configured" : "not-set",
      createdAt: new Date().toISOString().split("T")[0],
    };

    updateSettings((prev) => ({
      ...prev,
      keychain: [...prev.keychain, entry],
    }));

    setNewServiceName("");
    setNewKeyValue("");
    setShowAddForm(false);
  };

  const handleRemoveKey = (id: string) => {
    updateSettings((prev) => ({
      ...prev,
      keychain: prev.keychain.filter((k) => k.id !== id),
    }));
  };

  return (
    <div>
      <div className="space-y-4">
        {/* Auth State Card - Small 1-line info */}
        <div className="flex items-center gap-2.5 rounded-lg border bg-background/50 px-3.5 py-2.5 text-xs text-muted-foreground [border-color:var(--layout-separator)]">
          <Shield className="size-4 shrink-0 text-primary" />
          <span className="truncate">
            Credentials are encrypted at rest using system-native keychain (macOS Keychain / Windows
            Credential Manager).
          </span>
        </div>

        {/* Credentials List */}
        <div className="rounded-lg border [border-color:var(--layout-separator)]">
          {keychain.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No API keys configured yet.
            </div>
          ) : (
            keychain.map((entry, index) => (
              <div key={entry.id}>
                {index > 0 ? <SettingDivider /> : null}
                <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{entry.name}</span>
                      <span className="text-[10px] text-muted-foreground/60">{entry.service}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {entry.key || `${entry.service}.api-key (not set)`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveKey(entry.id)}
                    title="Remove credential"
                    className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add Key Form */}
        {showAddForm ? (
          <form
            onSubmit={handleAddKey}
            className="rounded-lg border bg-background/80 p-4 space-y-3 [border-color:var(--layout-separator)]"
          >
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Add New API Key
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Service Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. OpenAI Key, Custom LLM"
                  value={newServiceName}
                  onChange={(e) => setNewServiceName(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-xs text-foreground [border-color:var(--layout-separator)] outline-none focus:ring-1 focus:ring-ring/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  API Key Secret
                </label>
                <input
                  type="password"
                  required
                  placeholder="sk-..."
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-xs text-foreground [border-color:var(--layout-separator)] outline-none focus:ring-1 focus:ring-ring/50"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Save Credential
              </button>
            </div>
          </form>
        ) : (
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors [border-color:var(--layout-separator)] hover:bg-accent"
            >
              <Plus className="size-4" />
              Add API Key
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Core Plugins page                                                  */
/* ------------------------------------------------------------------ */

interface PluginRegistryItem {
  id: string;
  name: string;
  description: string;
}

const pluginRegistry: PluginRegistryItem[] = [
  {
    id: "file-explorer",
    name: "Files",
    description: "Browse the files and folders in your vault.",
  },
  {
    id: "search",
    name: "Search",
    description: "Full-text search across all notes, tags, and properties in your vault.",
  },
  {
    id: "backlinks",
    name: "Backlinks",
    description: "Show links from other files to the current file.",
  },
  {
    id: "bookmarks",
    name: "Bookmarks",
    description: "Save shortcuts to files, searches, headings, and graphs.",
  },
  {
    id: "canvas",
    name: "Canvas",
    description: "Arrange and connect notes on an infinite canvas.",
  },
  {
    id: "command-palette",
    name: "Command palette",
    description: "Use Cmd/Ctrl+P and begin typing to invoke a command.",
  },
  {
    id: "daily-notes",
    name: "Daily notes",
    description: "Create or open today's daily note.",
  },
  {
    id: "file-recovery",
    name: "File recovery",
    description: "Restore recent snapshots to recover from accidental data loss.",
  },
  {
    id: "graph-view",
    name: "Graph View",
    description:
      "Visualize connections and relationships between your notes in an interactive graph.",
  },
  {
    id: "live-preview",
    name: "Live Preview",
    description: "Rich editing experience with inline Markdown formatting rendering in real time.",
  },
  {
    id: "note-composer",
    name: "Note composer",
    description: "Merge two notes or split one into two.",
  },
  {
    id: "outline",
    name: "Outline",
    description: "Show the table of contents for the current note.",
  },
  {
    id: "page-preview",
    name: "Page preview",
    description: "Hover an internal link to preview its content.",
  },
  {
    id: "properties",
    name: "Properties view",
    description: "Show the metadata for your files in the sidebar.",
  },
  {
    id: "quick-switcher",
    name: "Quick switcher",
    description: "Jump to other files with your keyboard.",
  },
  {
    id: "sync",
    name: "Sync",
    description: "Synchronise your files through system synchronization.",
  },
  {
    id: "templates",
    name: "Templates",
    description: "Insert template content from a folder of template files.",
  },
  {
    id: "word-count",
    name: "Word count",
    description: "Show word count in the status bar.",
  },
];

function CorePluginsPage() {
  const { settings, updateSettings } = useSymtabSettings();
  const pluginsState = settings.plugins;
  const [searchQuery, setSearchQuery] = useState("");

  const togglePlugin = (id: string) => {
    const nextVal = !pluginsState[id];
    updateSettings((prev) => {
      const nextPlugins = { ...prev.plugins, [id]: nextVal };
      const nextEditor =
        id === "live-preview" ? { ...prev.editor, livePreview: nextVal } : prev.editor;
      return {
        ...prev,
        editor: nextEditor,
        plugins: nextPlugins,
      };
    });
  };

  const filteredPlugins = pluginRegistry.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div>
      {/* Search Bar */}
      <div className="relative mt-4 mb-6">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search plugins..."
          className="w-full rounded-lg border bg-background/50 py-2 pl-9 pr-3 text-sm text-foreground [border-color:var(--layout-separator)] outline-none focus:ring-1 focus:ring-ring/50"
        />
      </div>

      <div className="space-y-1">
        {filteredPlugins.map((plugin, index) => {
          const isEnabled = pluginsState[plugin.id] !== false;

          return (
            <div key={plugin.id}>
              {index > 0 ? <SettingDivider /> : null}
              <div className="flex items-center justify-between gap-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{plugin.name}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {plugin.description}
                  </div>
                </div>
                <div className="shrink-0">
                  <Toggle
                    checked={isEnabled}
                    onChange={() => togglePlugin(plugin.id)}
                    label={`Toggle ${plugin.name}`}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Community Plugins page                                             */
/* ------------------------------------------------------------------ */

function CommunityPluginsPage({ onOpenPlugins }: { onOpenPlugins: () => void }) {
  return (
    <SettingRow
      label="Manage community plugins"
      description="Install packages, review capabilities, and enable plugins separately for each vault."
    >
      <button
        type="button"
        onClick={onOpenPlugins}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open plugin manager
      </button>
    </SettingRow>
  );
}

/* ------------------------------------------------------------------ */
/*  Root Settings Dialog                                               */
/* ------------------------------------------------------------------ */

const pageComponents: Partial<Record<SettingsPage, React.ComponentType<{ vaultName: string }>>> = {
  editor: EditorPage,
  appearance: AppearancePage,
  keychain: KeychainPage,
  "core-plugins": CorePluginsPage,
};

const dailyConfigDefaults = {
  dailyFolder: "Daily",
  weeklyFolder: "Daily/Weekly",
  inboxPath: "Inbox",
  dailyFormat: "YYYY-MM-DD",
  weeklyFormat: "GGGG-[W]WW",
  dailyTemplate: "",
  weeklyTemplate: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

function DailyNotesPage({
  client,
  vaultId,
  onSaved,
}: {
  client: SymtabClient | null;
  vaultId?: string;
  onSaved?: () => void;
}) {
  const [config, setConfig] = useState(dailyConfigDefaults);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (!client || !vaultId) return;
    void client
      .getVaultConfig(vaultId)
      .then((value) => {
        if (active) setConfig({ ...dailyConfigDefaults, ...value });
      })
      .catch((cause) => {
        if (active) setMessage(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [client, vaultId]);
  const fields: Array<[keyof typeof dailyConfigDefaults, string, string]> = [
    ["dailyFolder", "Daily note folder", "Daily"],
    ["weeklyFolder", "Weekly note folder", "Daily/Weekly"],
    ["inboxPath", "Quick Capture folder", "Inbox"],
    ["dailyFormat", "Daily filename format", "YYYY-MM-DD"],
    ["weeklyFormat", "Weekly filename format", "GGGG-[W]WW"],
    ["dailyTemplate", "Daily template", "Templates/Daily.md"],
    ["weeklyTemplate", "Weekly template", "Templates/Weekly.md"],
    ["timeZone", "IANA time zone", "Asia/Kolkata"],
  ];
  return (
    <div>
      <h2 className="text-xl font-semibold">Daily Notes</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Stored per vault in protected <code>.symtab/config.json</code>.
      </p>
      <div className="mt-6 space-y-4">
        {fields.map(([key, label, placeholder]) => (
          <label key={key} className="block">
            <span className="text-xs font-medium">{label}</span>
            <input
              value={config[key]}
              placeholder={placeholder}
              onChange={(event) =>
                setConfig((current) => ({ ...current, [key]: event.target.value }))
              }
              className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm [border-color:var(--layout-separator)]"
            />
          </label>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{message}</span>
        <button
          type="button"
          disabled={!client || !vaultId}
          onClick={() => {
            if (!client || !vaultId) return;
            setMessage("");
            void client
              .putVaultConfig(vaultId, config)
              .then(() => {
                setMessage("Saved");
                onSaved?.();
              })
              .catch((cause) => setMessage(cause instanceof Error ? cause.message : String(cause)));
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function MCPConnectionsPage({
  client,
  vaults,
  getMCPServerCommand,
}: {
  client: SymtabClient | null;
  vaults: RecentVault[];
  getMCPServerCommand?: () => Promise<{ command: string; args: string[] }>;
}) {
  const [connections, setConnections] = useState<MCPConnection[]>([]);
  const [name, setName] = useState("VS Code");
  const [vaultIds, setVaultIds] = useState<string[]>([]);
  const [mode, setMode] = useState<MCPConnection["mode"]>("guided_write");
  const [credential, setCredential] = useState<MCPConnectionCredential | null>(null);
  const [config, setConfig] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void client
      ?.listMCPConnections()
      .then((items) => {
        if (active) setConnections(items);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [client]);

  const create = async () => {
    if (!client || vaultIds.length === 0 || !name.trim()) return;
    setError("");
    try {
      const created = await client.createMCPConnection({
        name: name.trim(),
        mode,
        vaultIds,
      });
      const executable = await getMCPServerCommand?.();
      const value = {
        servers: {
          symtab: {
            type: "stdio",
            command: executable?.command ?? "symtab-server",
            args: [
              ...(executable?.args ?? ["mcp"]),
              "--connection",
              created.id,
              "--secret",
              created.secret,
            ],
          },
        },
      };
      setCredential(created);
      setConfig(JSON.stringify(value, null, 2));
      setConnections(await client.listMCPConnections());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold">MCP connections</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Grant an AI client access to selected vaults. Secrets are shown once.
      </p>
      <div className="mt-6 grid gap-3 rounded-lg border p-4 [border-color:var(--layout-separator)]">
        <input
          aria-label="Connection name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm [border-color:var(--layout-separator)]"
        />
        <fieldset className="rounded-md border p-3 [border-color:var(--layout-separator)]">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Granted vaults</legend>
          {vaults.map((vault) => (
            <label key={vault.vaultId} className="flex items-center gap-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={vaultIds.includes(vault.vaultId)}
                onChange={(event) =>
                  setVaultIds((current) =>
                    event.target.checked
                      ? [...current, vault.vaultId]
                      : current.filter((id) => id !== vault.vaultId)
                  )
                }
              />
              <span className="truncate">{vault.displayName}</span>
            </label>
          ))}
          {vaults.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Open a vault before creating a connection.
            </p>
          ) : null}
        </fieldset>
        <select
          aria-label="Permission mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as MCPConnection["mode"])}
          className="h-9 rounded-md border bg-background px-3 text-sm [border-color:var(--layout-separator)]"
        >
          <option value="read_only">Read only</option>
          <option value="guided_write">Guided writes</option>
          <option value="trusted_workspace">Trusted workspace</option>
        </select>
        <button
          type="button"
          disabled={!client || vaultIds.length === 0 || !name.trim()}
          onClick={() => void create()}
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          Create connection
        </button>
      </div>
      {credential ? (
        <div className="mt-4 rounded-lg border p-4 [border-color:var(--layout-separator)]">
          <div className="text-sm font-medium">Copy this configuration now</div>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-[11px]">
            {config}
          </pre>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(config)}
            className="mt-2 rounded-md border px-3 py-1.5 text-xs [border-color:var(--layout-separator)]"
          >
            Copy configuration
          </button>
        </div>
      ) : null}
      <div className="mt-5 space-y-2">
        {connections
          .filter((connection) => !connection.revokedAt)
          .map((connection) => (
            <div
              key={connection.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 [border-color:var(--layout-separator)]"
            >
              <div>
                <div className="text-sm font-medium">{connection.name}</div>
                <div className="text-xs text-muted-foreground">
                  {connection.mode.replaceAll("_", " ")} · {connection.vaultIds.length} vault
                </div>
              </div>
              <button
                type="button"
                className="text-xs text-destructive"
                onClick={() =>
                  void client?.revokeMCPConnection(connection.id).then(async () => {
                    setConnections(
                      (await client.listMCPConnections()).filter((item) => !item.revokedAt)
                    );
                  })
                }
              >
                Revoke
              </button>
            </div>
          ))}
      </div>
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  onOpenPlugins,
  vaultName = "",
  client = null,
  vaults = [],
  vaultId,
  onVaultConfigChange,
  getMCPServerCommand,
  onMenuBarIconChange,
}: SettingsDialogProps) {
  const [activePage, setActivePage] = useState<SettingsPage>("general");
  const ActivePageComponent = pageComponents[activePage] ?? GeneralPage;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[min(680px,calc(100vh-4rem))] w-[min(900px,calc(100vw-4rem))] max-w-none flex-row overflow-hidden rounded-xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogClose className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </DialogClose>

        {/* Left navigation */}
        <div className="flex w-52 shrink-0 flex-col border-r bg-sidebar p-3 [border-color:var(--layout-separator)]">
          <div className="mb-4 flex items-center px-2">
            <span className="text-sm font-semibold text-foreground">Settings</span>
          </div>

          <SettingsNav activePage={activePage} onSelect={setActivePage} />

          <div className="mt-auto px-2 pt-4 text-[10px] text-muted-foreground/50">
            Symtab v0.0.1
          </div>
        </div>

        {/* Right content panel */}
        <div className="symtab-editor-scroll flex-1 overflow-y-auto p-8">
          {activePage === "community-plugins" ? (
            <CommunityPluginsPage onOpenPlugins={onOpenPlugins} />
          ) : activePage === "mcp" ? (
            <MCPConnectionsPage
              client={client}
              vaults={vaults}
              getMCPServerCommand={getMCPServerCommand}
            />
          ) : activePage === "daily-notes" ? (
            <DailyNotesPage client={client} vaultId={vaultId} onSaved={onVaultConfigChange} />
          ) : activePage === "general" ? (
            <GeneralPage vaultName={vaultName} onMenuBarIconChange={onMenuBarIconChange} />
          ) : (
            <ActivePageComponent vaultName={vaultName} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
