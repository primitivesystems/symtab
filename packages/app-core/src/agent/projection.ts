import type {
  AgentEvent,
  AgentEventPayloadMap,
  AgentThread,
} from "@symtab/bridge-contract";
import type {
  ChatMessage,
  ThreadAssistantMessagePart,
  ToolApprovalOptionKind,
  ToolCallMessagePart,
} from "@symtab/shared-ui/components/ai/chat";

type StreamMetadata = {
  timing?: {
    streamStartTime: number;
    totalChunks: number;
    toolCallCount: number;
    totalStreamTime?: number;
    tokenCount?: number;
  };
  custom?: Record<string, unknown>;
};

export class AgentTurnProjection {
  private parts: ThreadAssistantMessagePart[];
  private startedAt = performance.now();
  private usage?: AgentEventPayloadMap["turn.completed"]["usage"];
  private chunks = 0;
  private finalStatus: ChatMessage["status"];

  constructor(
    private readonly modelLabel: string,
    initialParts: readonly ThreadAssistantMessagePart[] = [],
  ) {
    this.parts = [...initialParts];
  }

  apply(event: AgentEvent) {
    this.chunks += 1;
    switch (event.type) {
      case "reasoning.delta":
        this.appendTextPart("reasoning", event.payload.itemId, event.payload.delta);
        break;
      case "reasoning.completed":
        this.completePart("reasoning", event.payload.itemId);
        break;
      case "message.delta":
        this.appendTextPart("text", event.payload.messageId, event.payload.delta);
        break;
      case "message.completed":
        this.completePart("text", event.payload.messageId);
        break;
      case "source.added":
        if (!this.parts.some((part) => part.type === "source" && part.id === event.payload.sourceId)) {
          this.parts.push({
            type: "source",
            sourceType: "url",
            id: event.payload.sourceId,
            url: event.payload.url,
            title: event.payload.title,
          });
        }
        break;
      case "tool.started":
        this.upsertTool(event.payload.toolCallId, {
          type: "tool-call",
          toolCallId: event.payload.toolCallId,
          toolName: event.payload.name || "tool",
          args: {},
          argsText: "",
        });
        break;
      case "tool.updated": {
        const current = this.tool(event.payload.toolCallId);
        this.upsertTool(event.payload.toolCallId, {
          ...(current ?? {
            type: "tool-call",
            toolCallId: event.payload.toolCallId,
            toolName: "tool",
            args: {},
            argsText: "",
          }),
          ...(event.payload.status === "running"
            ? {}
            : {
                result:
                  event.payload.detail ||
                  (event.payload.status === "completed"
                    ? "Completed"
                    : event.payload.status),
                isError: event.payload.status === "failed",
              }),
        });
        break;
      }
      case "approval.requested": {
        const toolCallId = event.payload.toolCallId ?? `approval:${event.payload.requestId}`;
        const current = this.tool(toolCallId);
        this.upsertTool(toolCallId, {
          ...(current ?? {
            type: "tool-call",
            toolCallId,
            toolName: "permission",
            args: { detail: event.payload.detail ?? "" },
            argsText: JSON.stringify({ detail: event.payload.detail ?? "" }),
          }),
          approval: {
            id: event.payload.requestId,
            options: event.payload.options.map((option) => ({
              id: option.id,
              label: option.label,
              kind: approvalKind(option.kind),
            })),
          },
        });
        break;
      }
      case "approval.resolved": {
        const index = this.parts.findIndex(
          (part) => part.type === "tool-call" && part.approval?.id === event.payload.requestId,
        );
        if (index >= 0) {
          const part = this.parts[index] as ToolCallMessagePart;
          const option = part.approval?.options?.find(
            (item) => item.id === event.payload.optionId,
          );
          this.parts[index] = {
            ...part,
            approval: {
              ...part.approval!,
              optionId: event.payload.optionId,
              approved: option?.kind.startsWith("allow") ?? false,
            },
          };
        }
        break;
      }
      case "plan.updated":
        this.upsertTool("symtab-plan", {
          type: "tool-call",
          toolCallId: "symtab-plan",
          toolName: "plan",
          args: { entries: event.payload.entries },
          argsText: JSON.stringify({ entries: event.payload.entries }),
          result: event.payload.entries.every((entry) => entry.status === "completed")
            ? "Plan completed"
            : undefined,
        });
        break;
      case "file.change.started":
        this.upsertTool(event.payload.changeId, {
          type: "tool-call",
          toolCallId: event.payload.changeId,
          toolName: "file_change",
          args: { path: event.payload.path },
          argsText: JSON.stringify({ path: event.payload.path }),
          artifact: { path: event.payload.path, oldText: event.payload.oldText, newText: "" },
        });
        break;
      case "file.change.delta": {
        const current = this.tool(event.payload.changeId);
        const artifact = isRecord(current?.artifact) ? current.artifact : {};
        const previous = typeof artifact.newText === "string" ? artifact.newText : "";
        this.upsertTool(event.payload.changeId, {
          ...(current ?? {
            type: "tool-call",
            toolCallId: event.payload.changeId,
            toolName: "file_change",
            args: {},
            argsText: "",
          }),
          artifact: {
            ...artifact,
            newText:
              previous.slice(0, event.payload.offset) +
              event.payload.delta +
              previous.slice(event.payload.offset + event.payload.delta.length),
          },
        });
        break;
      }
      case "file.change.completed": {
        const current = this.tool(event.payload.changeId);
        if (current) this.upsertTool(event.payload.changeId, { ...current, result: "Changed" });
        break;
      }
      case "turn.completed":
        this.usage = event.payload.usage;
        this.finalStatus = event.payload.status === "completed"
          ? { type: "complete", reason: "stop" }
          : { type: "incomplete", reason: event.payload.status === "interrupted" ? "cancelled" : "error" };
        this.parts = this.parts.map((part) => part.type === "text" || part.type === "reasoning"
          ? { ...part, status: { type: "complete" } } : part);
        break;
      default:
        break;
    }
  }

  content(): readonly ThreadAssistantMessagePart[] {
    return this.parts.map((part) => ({ ...part }));
  }

  status(): ChatMessage["status"] {
    if (this.finalStatus) return this.finalStatus;
    if (this.parts.some((part) => part.type === "tool-call" && part.approval && !part.approval.optionId)) {
      return { type: "requires-action", reason: "tool-calls" };
    }
    return { type: "incomplete", reason: "cancelled" };
  }

  metadata(): StreamMetadata {
    return {
      timing: {
        streamStartTime: this.startedAt,
        totalChunks: this.chunks,
        toolCallCount: this.parts.filter((part) => part.type === "tool-call").length,
        totalStreamTime: this.usage?.durationMs ?? performance.now() - this.startedAt,
        tokenCount: this.usage
          ? this.usage.inputTokens + this.usage.outputTokens
          : undefined,
      },
      custom: { modelLabel: this.modelLabel },
    };
  }

  private appendTextPart(type: "reasoning" | "text", id: string, delta: string) {
    const index = this.parts.findIndex(
      (part) => part.type === type && symtabPartID(part) === id,
    );
    if (index >= 0) {
      const part = this.parts[index];
      if (part?.type === type) {
        this.parts[index] = { ...part, text: part.text + delta, status: { type: "running" } };
      }
      return;
    }
    this.parts.push({
      type,
      text: delta,
      status: { type: "running" },
      providerMetadata: { symtab: { id } },
    });
  }

  private completePart(type: "reasoning" | "text", id: string) {
    const index = this.parts.findIndex(
      (part) => part.type === type && symtabPartID(part) === id,
    );
    const part = this.parts[index];
    if (index >= 0 && part?.type === type) {
      this.parts[index] = { ...part, status: { type: "complete" } };
    }
  }

  private tool(id: string) {
    const part = this.parts.find(
      (candidate) => candidate.type === "tool-call" && candidate.toolCallId === id,
    );
    return part?.type === "tool-call" ? part : undefined;
  }

  private upsertTool(id: string, tool: ToolCallMessagePart) {
    const index = this.parts.findIndex(
      (part) => part.type === "tool-call" && part.toolCallId === id,
    );
    if (index >= 0) this.parts[index] = tool;
    else this.parts.push(tool);
  }
}

export function projectAgentHistory(thread: AgentThread, events: readonly AgentEvent[]) {
  const turns = new Map<
    string,
    { prompt: string; createdAt: Date; projection: AgentTurnProjection }
  >();
  for (const event of events) {
    if (!event.turnId) continue;
    let turn = turns.get(event.turnId);
    if (!turn) {
      turn = {
        prompt: "",
        createdAt: new Date(event.createdAt),
        projection: new AgentTurnProjection(thread.configuration.model ?? thread.configuration.providerId),
      };
      turns.set(event.turnId, turn);
    }
    if (event.type === "turn.started") turn.prompt = event.payload.prompt;
    else turn.projection.apply(event);
  }
  const messages: ChatMessage[] = [];
  for (const [turnID, turn] of turns) {
    messages.push({
      id: `${turnID}:user`,
      role: "user",
      text: turn.prompt,
      createdAt: turn.createdAt,
    });
    if (turn.projection.content().length) {
      messages.push({
        id: `${turnID}:assistant`,
        role: "assistant",
        content: turn.projection.content(),
        createdAt: turn.createdAt,
        metadata: turn.projection.metadata(),
        status: turn.projection.status(),
      });
    }
  }
  return messages;
}

export function findApprovalResponse(parts: readonly ThreadAssistantMessagePart[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type !== "tool-call" || !part.approval?.id || !part.approval.optionId) continue;
    return { requestId: part.approval.id, optionId: part.approval.optionId };
  }
  return undefined;
}

function symtabPartID(part: Extract<ThreadAssistantMessagePart, { type: "text" | "reasoning" }>) {
  const symtab = part.providerMetadata?.symtab;
  return isRecord(symtab) && typeof symtab.id === "string" ? symtab.id : undefined;
}

function approvalKind(kind: AgentEventPayloadMap["approval.requested"]["options"][number]["kind"]): ToolApprovalOptionKind {
  switch (kind) {
    case "allow_once":
      return "allow-once";
    case "allow_always":
      return "allow-always";
    case "reject_always":
      return "reject-always";
    default:
      return "reject-once";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
