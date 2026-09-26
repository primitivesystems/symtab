"use client";

import * as React from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";

import { Thread } from "../assistant-ui/thread";
import { ChatComposerControls, ChatContextUsage } from "./chat/chat-controls";
import { ChatSessionHeader } from "./chat/chat-session-header";
import { readDroppedTab } from "../design-system/workbench/editor/editor-dnd";
import {
  CHAT_ATTACHMENTS,
  createPreviewModelAdapter,
  type ChatConfiguration,
  type ChatProviderOption,
} from "./chat/chat-runtime";

export type { ChatConfiguration, ChatProviderOption } from "./chat/chat-runtime";
export type {
  ChatModelAdapter,
  ThreadAssistantMessagePart,
  ToolApprovalOptionKind,
  ToolCallMessagePart,
} from "@assistant-ui/react";

export type ChatSession = { id: string; title: string };
export type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text?: string;
  content?: ThreadMessageLike["content"];
  createdAt?: Date;
  metadata?: ThreadMessageLike["metadata"];
  status?: ThreadMessageLike["status"];
};

export type ChatModelAdapterFactory = (
  sessionId: string,
  getConfiguration: () => ChatConfiguration,
) => ChatModelAdapter;

export type ChatProps = {
  sessions?: ChatSession[];
  activeSessionId?: string;
  messages?: ChatMessage[];
  providers?: readonly ChatProviderOption[];
  configuration?: ChatConfiguration;
  modelAdapterFactory?: ChatModelAdapterFactory;
  onNewChat?: () => void;
  onSelectSession?: (id: string) => void;
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  onSend?: (message: string) => void;
  onConfigurationChange?: (configuration: ChatConfiguration) => void;
  onResolveAttachment?: (path: string) => Promise<File>;
};

const DEFAULT_SESSIONS: ChatSession[] = [
  { id: "welcome", title: "New chat" },
  { id: "workbench", title: "Workbench layout" },
];

const DEFAULT_CONFIGURATION: ChatConfiguration = {
  mode: "agent",
  provider: "openai",
  model: "gpt-5.6-terra",
  effort: "medium",
};

export function Chat({
  sessions,
  activeSessionId,
  messages = [],
  providers,
  configuration: controlledConfiguration,
  modelAdapterFactory,
  onNewChat,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onSend,
  onConfigurationChange,
  onResolveAttachment,
}: ChatProps) {
  const controlled = sessions !== undefined;
  const [localSessions, setLocalSessions] = React.useState<ChatSession[]>(
    sessions ?? DEFAULT_SESSIONS,
  );
  const [localActiveId, setLocalActiveId] = React.useState(
    activeSessionId ?? localSessions[0]?.id ?? "welcome",
  );
  const [localConfiguration, setLocalConfiguration] =
    React.useState<ChatConfiguration>(DEFAULT_CONFIGURATION);
  const configuration = controlledConfiguration ?? localConfiguration;

  const visibleSessions = controlled ? sessions : localSessions;
  const selectedId =
    activeSessionId ??
    (visibleSessions.some((session) => session.id === localActiveId)
      ? localActiveId
      : visibleSessions[0]?.id);

  function selectSession(id: string) {
    setLocalActiveId(id);
    onSelectSession?.(id);
  }

  function createSession() {
    const session = { id: crypto.randomUUID(), title: "New chat" };
    if (!controlled) setLocalSessions((current) => [session, ...current]);
    setLocalActiveId(session.id);
    onNewChat?.();
  }

  function renameSession(id: string, title: string) {
    if (controlled) return onRenameSession?.(id, title);
    setLocalSessions((current) =>
      current.map((session) => (session.id === id ? { ...session, title } : session)),
    );
  }

  function deleteSession(id: string) {
    if (controlled) return onDeleteSession?.(id);
    setLocalSessions((current) => {
      const next = current.filter((session) => session.id !== id);
      if (next.length) {
        setLocalActiveId((active) => (active === id ? next[0]!.id : active));
        return next;
      }
      const replacement = { id: crypto.randomUUID(), title: "New chat" };
      setLocalActiveId(replacement.id);
      return [replacement];
    });
  }

  function updateConfiguration(next: ChatConfiguration) {
    setLocalConfiguration(next);
    onConfigurationChange?.(next);
  }

  return (
    <section
      aria-label="AI chat"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent text-[var(--workbench-fg)]"
    >
      <ChatSessionHeader
        sessions={visibleSessions}
        activeSessionId={selectedId}
        canManage={!controlled || Boolean(onRenameSession && onDeleteSession)}
        onCreate={createSession}
        onDelete={deleteSession}
        onRename={renameSession}
        onSelect={selectSession}
      />

      <div className="relative min-h-0 flex-1">
        {selectedId ? (
          <ChatRuntime
            key={selectedId}
            sessionId={selectedId}
            configuration={configuration}
            initialMessages={messages}
            providers={providers}
            modelAdapterFactory={modelAdapterFactory}
            onConfigurationChange={updateConfiguration}
            onSend={onSend}
            onResolveAttachment={onResolveAttachment}
          />
        ) : null}
      </div>
    </section>
  );
}

function ChatRuntime({
  sessionId,
  configuration,
  initialMessages,
  providers,
  modelAdapterFactory,
  onConfigurationChange,
  onSend,
  onResolveAttachment,
}: {
  sessionId: string;
  configuration: ChatConfiguration;
  initialMessages: ChatMessage[];
  providers?: readonly ChatProviderOption[];
  modelAdapterFactory?: ChatModelAdapterFactory;
  onConfigurationChange: (configuration: ChatConfiguration) => void;
  onSend?: (message: string) => void;
  onResolveAttachment?: (path: string) => Promise<File>;
}) {
  const [dropError, setDropError] = React.useState<string>();
  const adapter = React.useMemo(
    () =>
      modelAdapterFactory?.(sessionId, () => configuration) ??
      createPreviewModelAdapter(() => configuration, onSend),
    [configuration, modelAdapterFactory, onSend, sessionId],
  );
  const runtime = useLocalRuntime(adapter, {
    initialMessages: initialMessages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content ?? message.text ?? "",
      createdAt: message.createdAt ?? new Date(),
      metadata: message.metadata,
      status:
        message.role === "assistant"
          ? (message.status ?? { type: "complete", reason: "stop" } as const)
          : undefined,
    })),
    adapters: { attachments: CHAT_ATTACHMENTS },
  });

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOver={(event) => {
        if (event.dataTransfer.types.some((type) => type === "Files" || type.startsWith("application/x-symtab-"))) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files);
        const internal = event.dataTransfer.types.some((type) => type.startsWith("application/x-symtab-"));
        if (!files.length && !internal) return;
        event.preventDefault();
        event.stopPropagation();
        const tab = internal ? readDroppedTab(event.dataTransfer)?.tab : undefined;
        setDropError(undefined);
        void (async () => {
          if (tab?.id.startsWith("file:")) {
            if (!onResolveAttachment) throw new Error("Open a vault before attaching workspace files.");
            files.push(await onResolveAttachment(tab.id.slice(5)));
          }
          for (const file of files) {
            if (file.size > 10 * 1024 * 1024) throw new Error("Attachments must be smaller than 10 MB.");
            await runtime.thread.composer.addAttachment(file);
          }
        })().catch((error) => setDropError(error instanceof Error ? error.message : "Could not attach file"));
      }}
    >
      {dropError ? <p role="alert" className="px-3 py-2 text-sm text-destructive">{dropError}</p> : null}
      <AssistantRuntimeProvider runtime={runtime}>
        <Thread
          composerControls={
            <ChatComposerControls
              configuration={configuration}
              providers={providers}
              onConfigurationChange={onConfigurationChange}
            />
          }
          composerContext={
            <ChatContextUsage configuration={configuration} providers={providers} />
          }
        />
      </AssistantRuntimeProvider>
    </div>
  );
}
