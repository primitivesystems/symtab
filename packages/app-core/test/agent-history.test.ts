import { expect, test } from "bun:test";
import type { AgentEvent, AgentThread } from "@symtab/bridge-contract";
import { projectAgentHistory } from "../src/agent/projection";
import { lastUserText } from "../src/agent/use-agent-chat";

test("history preserves markdown, completed reasoning, status and usage", () => {
  const base = { eventId: "event", threadId: "thread", turnId: "turn", createdAt: "2026-09-02T00:00:00Z" };
  const thread: AgentThread = { id: "thread", vaultId: "vault", configuration: { providerId: "codex", model: "test", mode: "agent" }, status: "idle", createdAt: base.createdAt, updatedAt: base.createdAt };
  const events: AgentEvent[] = [
    { ...base, sequence: 1, type: "turn.started", payload: { prompt: "Explain" } },
    { ...base, sequence: 2, type: "reasoning.delta", payload: { itemId: "r", delta: "Checking the file" } },
    { ...base, sequence: 3, type: "message.delta", payload: { messageId: "m", delta: "**Done**\n\n```ts\n" } },
    { ...base, sequence: 4, type: "message.delta", payload: { messageId: "m", delta: "const a = 1;\n```" } },
    { ...base, sequence: 5, type: "turn.completed", payload: { status: "completed", usage: { inputTokens: 12, outputTokens: 8, durationMs: 1500 } } },
  ];
  const messages = projectAgentHistory(thread, JSON.parse(JSON.stringify(events)));
  expect(messages[1]?.content).toMatchObject([
    { type: "reasoning", text: "Checking the file", status: { type: "complete" } },
    { type: "text", text: "**Done**\n\n```ts\nconst a = 1;\n```", status: { type: "complete" } },
  ]);
  expect(messages[1]?.metadata?.timing?.tokenCount).toBe(20);
  expect(messages[1]?.metadata?.timing?.totalStreamTime).toBe(1500);
  expect(messages[1]?.status).toEqual({ type: "complete", reason: "stop" });
});

test("provider prompt includes actual text attachment contents, never silently loses binary data", () => {
  expect(lastUserText([{ role: "user", content: [{ type: "text", text: "Review" }], attachments: [{ content: [{ type: "text", text: "const answer = 42;" }] }] }])).toBe("Review\n\nconst answer = 42;");
  expect(() => lastUserText([{ role: "user", content: [{ type: "image" }] }])).toThrow("text/code attachments only");
});
