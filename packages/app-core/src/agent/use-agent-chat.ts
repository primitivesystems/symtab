import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, AgentThread, SymtabClient } from "@symtab/bridge-contract";
import type {
  ChatModelAdapter,
  ChatConfiguration,
  ChatMessage,
  ChatProps,
  ChatProviderOption,
  ThreadAssistantMessagePart,
} from "@symtab/shared-ui/components/ai/chat";
import { AgentTurnProjection, findApprovalResponse, projectAgentHistory } from "./projection";
import type { SymtabStatePersistence } from "../app/state";

const DEFAULT_MODEL = { value: "default", label: "Default", context: 128_000 };

export function useAgentChat(client: SymtabClient | null, vaultId?: string, persistence?: SymtabStatePersistence): ChatProps | undefined {
  const [providers, setProviders] = useState<ChatProviderOption[]>([]);
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const cursors = useRef(new Map<string, number>());
  const loadRequest = useRef(0);
  const selectedThread = useRef<string | undefined>(undefined);

  const mergeThread = useCallback((thread: AgentThread) => {
    setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
  }, []);

  const loadThread = useCallback(async (thread: AgentThread) => {
    if (!client) return;
    const request = ++loadRequest.current;
    const events = await client.listAgentEvents(thread.id);
    if (request !== loadRequest.current) return;
    cursors.current.set(thread.id, events.at(-1)?.sequence ?? 0);
    setMessages(projectAgentHistory(thread, events));
    setActiveId(thread.id);
    selectedThread.current = thread.id;
    if (vaultId) await persistence?.saveAppSetting(`chat.active.${vaultId}`, thread.id);
  }, [client, persistence, vaultId]);

  const createThread = useCallback(async () => {
    if (!client || !vaultId || !providers.length) return;
    const request = ++loadRequest.current;
    const provider = providers.find((item) => item.available !== false) ?? providers[0]!;
    const thread = await client.createAgentThread({
      vaultId,
      title: "New chat",
      configuration: {
        providerId: provider.id,
        model: provider.models[0]?.value,
        mode: "agent",
        reasoningEffort: "medium",
      },
    });
    mergeThread(thread);
    if (request !== loadRequest.current) return;
    setMessages([]);
    setActiveId(thread.id);
    selectedThread.current = thread.id;
    await persistence?.saveAppSetting(`chat.active.${vaultId}`, thread.id);
  }, [client, mergeThread, providers, vaultId, persistence]);

  useEffect(() => {
    if (!client || !vaultId) return;
    let cancelled = false;
    void Promise.all([client.listAgentProviders(), client.listModelProviders(), client.listAgentThreads(vaultId), persistence?.loadAppSettings()])
      .then(async ([agents, models, savedThreads, settings]) => {
        if (cancelled) return;
        const options = agents.filter((agent) => agent.available).map((agent) => {
          const modelProvider = models.find((provider) => provider.id === agent.id);
          return {
            id: agent.id,
            label: agent.name,
            available: agent.available,
            models: modelProvider?.models?.length
              ? modelProvider.models.map((model) => ({ value: model, label: model, context: 128_000 }))
              : [DEFAULT_MODEL],
          };
        });
        setProviders(options);
        setThreads(savedThreads);
        const selected = savedThreads.find((thread) => thread.id === settings?.[`chat.active.${vaultId}`]) ?? savedThreads[0];
        if (selected) await loadThread(selected);
        else if (options[0]) {
          const thread = await client.createAgentThread({
            vaultId,
            title: "New chat",
            configuration: { providerId: options[0].id, model: options[0].models[0]?.value, mode: "agent", reasoningEffort: "medium" },
          });
          if (!cancelled) {
            setThreads([thread]);
            setMessages([]);
            setActiveId(thread.id);
            selectedThread.current = thread.id;
          }
        }
      })
      .catch(console.error);
    return () => {
      cancelled = true;
      // This is a request counter, not a DOM ref: invalidate outstanding loads on vault changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loadRequest.current++;
    };
  }, [client, loadThread, vaultId, persistence]);

  const active = threads.find((thread) => thread.id === activeId);
  const configuration = active ? toChatConfiguration(active) : undefined;

  const updateConfiguration = useCallback((next: ChatConfiguration) => {
    if (!client || !activeId) return;
    const configuration = {
      providerId: next.provider,
      model: next.model,
      mode: next.mode,
      reasoningEffort: next.effort === "max" ? "high" as const : next.effort,
    };
    setThreads((current) => current.map((thread) => thread.id === activeId ? { ...thread, configuration } : thread));
    void client.updateAgentThreadConfiguration(activeId, configuration)
      .then((thread) => setThreads((current) => current.map((item) => item.id === thread.id ? thread : item)))
      .catch(console.error);
  }, [activeId, client]);

  const modelAdapterFactory = useCallback((threadId: string, getConfiguration: () => ChatConfiguration): ChatModelAdapter => ({
    async *run({ messages: runMessages, abortSignal, unstable_getMessage }) {
      if (!client) throw new Error("Agent runtime is unavailable");
      const initial = unstable_getMessage().content.filter(isAssistantPart);
      const approval = findApprovalResponse(initial);
      const projection = new AgentTurnProjection(getConfiguration().model, initial);
      const queue = eventQueue(abortSignal);
      const stop = client.watchAgentThread(
        threadId,
        (event) => {
          cursors.current.set(threadId, event.sequence);
          queue.push(event);
        },
        queue.fail,
        cursors.current.get(threadId) ?? 0,
      );
      let turnId = activeTurnId(threads, threadId);
      try {
        if (approval) {
          await client.respondAgentApproval(threadId, approval.requestId, approval.optionId);
        } else {
          const prompt = lastUserText(runMessages);
          const turn = await client.startAgentTurn(threadId, { prompt });
          turnId = turn.id;
          mergeThread(await client.getAgentThread(threadId));
        }
        while (true) {
          const event = await queue.next();
          if (event.turnId && turnId && event.turnId !== turnId) continue;
          projection.apply(event);
          if (event.type === "runtime.error") throw new Error(event.payload.message);
          if (event.type === "approval.requested") {
            yield { content: projection.content(), status: { type: "requires-action", reason: "tool-calls" }, metadata: projection.metadata() };
            return;
          }
          if (event.type === "turn.completed") {
            mergeThread(await client.getAgentThread(threadId));
            yield {
              content: projection.content(),
              status: event.payload.status === "completed"
                ? { type: "complete", reason: "stop" }
                : { type: "incomplete", reason: event.payload.status === "interrupted" ? "cancelled" : "error" },
              metadata: projection.metadata(),
            };
            return;
          }
          yield { content: projection.content(), metadata: projection.metadata() };
        }
      } finally {
        stop();
        if (abortSignal.aborted && turnId) void client.interruptAgentTurn(threadId, turnId).catch(() => undefined);
        const events = await client.listAgentEvents(threadId).catch(() => undefined);
        const thread = threads.find((item) => item.id === threadId);
        if (events && thread && selectedThread.current === threadId) {
          setMessages(projectAgentHistory(thread, events));
        }
      }
    },
  }), [client, mergeThread, threads]);

  const renameSession = useCallback((id: string, title: string) => {
    if (!client) return;
    void client.renameAgentThread(id, title).then(mergeThread).catch(console.error);
  }, [client, mergeThread]);

  const deleteSession = useCallback(async (id: string) => {
    if (!client) return;
    await client.deleteAgentThread(id);
    const remaining = threads.filter((thread) => thread.id !== id);
    setThreads(remaining);
    if (id !== activeId) return;
    if (remaining[0]) await loadThread(remaining[0]);
    else await createThread();
  }, [activeId, client, createThread, loadThread, threads]);

  const resolveAttachment = useCallback(async (path: string) => {
    if (!client || !vaultId) throw new Error("No vault open");
    const file = await client.readFile(vaultId, path);
    return new File([file.content], path.split("/").pop() ?? path, { type: "text/plain" });
  }, [client, vaultId]);

  return useMemo(() => active && configuration ? {
    sessions: threads.map((thread) => ({ id: thread.id, title: thread.title || "New chat" })),
    activeSessionId: active.id,
    messages,
    providers,
    configuration,
    modelAdapterFactory,
    onNewChat: () => { void createThread(); },
    onSelectSession: (id: string) => {
      const thread = threads.find((item) => item.id === id);
      if (thread) void loadThread(thread);
    },
    onRenameSession: renameSession,
    onDeleteSession: (id: string) => { void deleteSession(id).catch(console.error); },
    onConfigurationChange: updateConfiguration,
    onResolveAttachment: resolveAttachment,
  } : undefined, [active, configuration, createThread, deleteSession, loadThread, messages, modelAdapterFactory, providers, renameSession, threads, updateConfiguration, resolveAttachment]);
}

function toChatConfiguration(thread: AgentThread): ChatConfiguration {
  return {
    provider: thread.configuration.providerId,
    model: thread.configuration.model ?? "default",
    mode: thread.configuration.mode === "tutor" ? "ask" : thread.configuration.mode,
    effort: thread.configuration.reasoningEffort ?? "medium",
  };
}

function activeTurnId(threads: readonly AgentThread[], threadId: string) {
  return threads.find((thread) => thread.id === threadId)?.activeTurnId;
}

type PromptPart = { type: string; text?: string; filename?: string };
export function lastUserText(messages: readonly {
  role: string;
  content: readonly PromptPart[];
  attachments?: readonly { content: readonly PromptPart[] }[];
}[]) {
  const message = [...messages].reverse().find((item) => item.role === "user");
  const parts = [...(message?.content ?? []), ...(message?.attachments?.flatMap((item) => item.content) ?? [])];
  if (parts.some((part) => part.type === "file" || part.type === "image")) {
    throw new Error("This provider connection currently accepts text/code attachments only. Remove binary or image attachments to send.");
  }
  return parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n\n").trim();
}

function isAssistantPart(part: unknown): part is ThreadAssistantMessagePart {
  return typeof part === "object" && part !== null && "type" in part;
}

function eventQueue(signal: AbortSignal) {
  const events: AgentEvent[] = [];
  let waiter: { resolve: (event: AgentEvent) => void; reject: (error: Error) => void } | undefined;
  let failure: Error | undefined;
  return {
    push(event: AgentEvent) { if (waiter) { const { resolve } = waiter; waiter = undefined; resolve(event); } else events.push(event); },
    fail(error: Error) { failure = error; waiter?.reject(error); waiter = undefined; },
    async next() {
      if (events.length) return events.shift()!;
      if (failure) throw failure;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return await new Promise<AgentEvent>((resolve, reject) => {
        waiter = { resolve, reject };
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    },
  };
}
