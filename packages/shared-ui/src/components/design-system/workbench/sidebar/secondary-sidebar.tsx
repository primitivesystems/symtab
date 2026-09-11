"use client";

import { AIChatPanel, type AIChatPanelProps } from "./ai-chat-panel";
import { WorkbenchPanel } from "../shared/workbench-panel";
import { WorkbenchIconButton } from "../shared/workbench-control";
import type { ReactNode } from "react";
import type { WorkbenchRightView } from "../types";
export type { ChatMessage, ChatSession } from "../../../ai/chat";

const views: readonly { id: Exclude<WorkbenchRightView, "chat">; label: string; icon: string }[] = [
  { id: "backlinks", label: "Backlinks", icon: "references" },
  { id: "outgoing", label: "Outgoing links", icon: "link-external" },
  { id: "tags", label: "Tags", icon: "tag" },
  { id: "properties", label: "Properties", icon: "symbol-property" },
  { id: "outline", label: "Outline", icon: "list-tree" },
];

export type SecondarySidebarProps = Partial<Omit<AIChatPanelProps, "area">> & {
  view: WorkbenchRightView;
  onViewChange: (view: WorkbenchRightView) => void;
  children?: ReactNode;
  maximized: boolean;
  onClose: () => void;
  onToggleMaximize: () => void;
};

export function SecondarySidebar({
  maximized,
  view,
  onViewChange,
  children,
  onClose,
  onToggleMaximize,
  ...chatProps
}: SecondarySidebarProps) {
  return (
    <WorkbenchPanel>
      <header
        className="flex h-[35px] shrink-0 items-center gap-0.5 px-1"
        aria-label="Secondary sidebar views"
      >
        {view === "chat" ? (
          <h2 className="min-w-0 flex-1 truncate px-1 text-[11px] font-normal uppercase tracking-[.04em]">
            Chat
          </h2>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {views.map((item) => (
              <WorkbenchIconButton
                key={item.id}
                icon={item.icon}
                aria-label={item.label}
                aria-pressed={view === item.id}
                selected={view === item.id}
                onClick={() => onViewChange(item.id)}
              />
            ))}
          </div>
        )}
        {view === "chat" ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <WorkbenchIconButton
              icon={maximized ? "screen-normal" : "screen-full"}
              aria-label={maximized ? "Restore AI chat" : "Maximize AI chat"}
              aria-pressed={maximized}
              onClick={onToggleMaximize}
            />
            <WorkbenchIconButton icon="close" aria-label="Close AI chat" onClick={onClose} />
          </div>
        ) : null}
      </header>
      {view === "chat" ? <AIChatPanel {...(chatProps as AIChatPanelProps)} /> : children}
    </WorkbenchPanel>
  );
}
