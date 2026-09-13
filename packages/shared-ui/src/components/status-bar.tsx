import type { ReactNode } from "react";
import {
  Check,
  ChevronsUpDown,
  CpuIcon,
  GitBranch,
  MemoryStick,
  Settings2,
  Vault,
} from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";

export interface FluxVaultOption {
  id: string;
  label: string;
}

export interface FluxStatusBarProps {
  activeVaultId: string;
  vaults: FluxVaultOption[];
  onVaultChange: (id: string) => void;
  onManageVaults?: () => void;
  version: string;
  updateStatus: string;
  gitStatus?: string;
  connectionStatus: string;
  characters: number;
  words: number;
  backlinks: number;
  cpuPercent?: number;
  memoryMB?: number;
  themeControl?: ReactNode;
}

function StatusSeparator() {
  return <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-[var(--layout-separator)]" />;
}

export function FluxStatusBar({
  activeVaultId,
  vaults,
  onVaultChange,
  onManageVaults,
  version,
  updateStatus,
  gitStatus,
  connectionStatus,
  characters,
  words,
  backlinks,
  cpuPercent,
  memoryMB,
  themeControl,
}: FluxStatusBarProps) {
  const activeVault = vaults.find((vault) => vault.id === activeVaultId) ?? vaults[0];

  return (
    <div className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label="Switch vault"
                className="flex h-7 min-w-0 max-w-48 items-center gap-1.5 rounded-sm px-1.5 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 data-popup-open:bg-accent data-popup-open:text-foreground"
              />
            }
          >
            <Vault className="size-3.5 shrink-0" />
            <span className="truncate font-medium text-foreground">
              {activeVault?.label ?? "Vault"}
            </span>
            <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
          </MenuTrigger>
          <MenuPopup side="top" align="start" sideOffset={6} className="z-[110] min-w-56">
            {vaults.map((vault) => (
              <MenuItem
                key={vault.id}
                onClick={() => onVaultChange(vault.id)}
                className="relative pr-8"
              >
                <span className="truncate">{vault.label}</span>
                {vault.id === activeVaultId ? <Check className="absolute right-2 size-4" /> : null}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem disabled={!onManageVaults} onClick={onManageVaults}>
              <Settings2 className="text-muted-foreground" />
              Manage vaults…
            </MenuItem>
          </MenuPopup>
        </Menu>
        <StatusSeparator />
        <span className="truncate" title={`${version} · ${updateStatus}`}>
          {version} · {updateStatus}
        </span>
        {gitStatus ? (
          <>
            <StatusSeparator />
            <span className="flex shrink-0 items-center gap-1" title="Git plugin status">
              <GitBranch className="size-3.5" />
              {gitStatus}
            </span>
          </>
        ) : null}
      </div>

      <span className="max-w-64 truncate px-2 text-center" title={connectionStatus}>
        {connectionStatus}
      </span>

      <div className="flex min-w-0 items-center justify-end gap-2 whitespace-nowrap">
        <span className="truncate">
          {characters.toLocaleString()} characters, {words.toLocaleString()} words,{" "}
          {backlinks.toLocaleString()} backlinks
        </span>
        <StatusSeparator />
        {cpuPercent !== undefined && memoryMB !== undefined ? (
          <>
            <span
              className="flex shrink-0 items-center gap-1 tabular-nums"
              title="Total CPU and working memory used by Symtab processes"
            >
              <CpuIcon className="size-3.5" />
              <span>CPU {cpuPercent.toFixed(1)}%</span>
              <span aria-hidden="true">·</span>
              <MemoryStick className="size-3.5" />
              <span>{Math.round(memoryMB).toLocaleString()} MB</span>
            </span>
            <StatusSeparator />
          </>
        ) : null}
        {themeControl}
      </div>
    </div>
  );
}
