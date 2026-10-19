import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createToolCallSanitizerExtension,
  sanitizeToolCallPayload,
  type SanitizeReport,
} from "./toolcall-sanitizer.ts";

/** Records the handlers the extension registers, standing in for `ExtensionAPI`. */
function fakePi(): {
  pi: ExtensionAPI;
  handlers: ((event: { payload: unknown }) => unknown)[];
} {
  const handlers: ((event: { payload: unknown }) => unknown)[] = [];
  const pi = {
    on(_event: string, handler: (event: { payload: unknown }) => unknown) {
      handlers.push(handler);
      return () => {};
    },
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

/** OpenAI wire shape of an assistant tool call. */
function call(id: string, name: string): unknown {
  return { id, type: "function", function: { name, arguments: "{}" } };
}

function toolResult(toolCallId: string): Record<string, unknown> {
  return { role: "tool", content: "ok", tool_call_id: toolCallId };
}

function assistant(
  toolCalls: unknown[],
  content?: string,
): Record<string, unknown> {
  return {
    role: "assistant",
    ...(content === undefined ? {} : { content }),
    tool_calls: toolCalls,
  };
}

/** A minimal provider payload: two declared tools, one healthy exchange. */
function basePayload(): Record<string, unknown> {
  return {
    model: "step-5-preview",
    messages: [
      { role: "system", content: "you are an agent" },
      { role: "user", content: "hi" },
      assistant([call("a", "bash")]),
      toolResult("a"),
    ],
    tools: [
      { type: "function", function: { name: "bash", parameters: {} } },
      { type: "function", function: { name: "read", parameters: {} } },
    ],
    tool_choice: "auto",
  };
}

describe("sanitizeToolCallPayload", () => {
  it("drops empty-name tool calls and their orphan tool results", () => {
    const payload = basePayload();
    (payload.messages as unknown[]).push(
      assistant([call("b", "bash"), call("c", "")]),
      toolResult("b"),
      toolResult("c"),
    );

    const result = sanitizeToolCallPayload(payload);
    assert.ok(result, "expected a sanitized payload");
    const { messages } = result.payload as {
      messages: Record<string, unknown>[];
    };

    const ids = messages
      .filter((m) => m.role === "tool")
      .map((m) => m.tool_call_id);
    assert.deepEqual(
      ids,
      ["a", "b"],
      "only calls answering live tool calls survive",
    );

    const poisoned = messages.filter(
      (m) => m.role === "assistant" && Array.isArray(m.tool_calls),
    );
    for (const message of poisoned) {
      for (const c of message.tool_calls as { function: { name: string } }[]) {
        assert.notEqual(c.function.name, "", "no empty-name call may survive");
      }
    }
  });

  it("returns a new object and leaves the input untouched", () => {
    const payload = basePayload();
    (payload.messages as unknown[]).push(
      assistant([call("b", "bash"), call("c", "")]),
      toolResult("c"),
    );
    const before = structuredClone(payload);

    const result = sanitizeToolCallPayload(payload);
    assert.ok(result);
    assert.notEqual(result.payload, payload, "must not return the same object");
    assert.notEqual(
      (result.payload as { messages: unknown[] }).messages,
      payload.messages,
      "must not reuse the messages array",
    );
    assert.deepEqual(payload, before, "input must not be mutated");
  });

  it("is idempotent: a second pass reports no change", () => {
    const payload = basePayload();
    (payload.messages as unknown[]).push(
      assistant([call("b", "bash"), call("c", "")]),
      toolResult("c"),
    );

    const first = sanitizeToolCallPayload(payload);
    assert.ok(first);
    const second = sanitizeToolCallPayload(first.payload);
    assert.equal(
      second,
      undefined,
      "already-clean payload must yield undefined",
    );
  });

  it("returns undefined for payloads with nothing to sanitize", () => {
    assert.equal(sanitizeToolCallPayload(basePayload()), undefined);
    assert.equal(sanitizeToolCallPayload(null), undefined);
    assert.equal(sanitizeToolCallPayload("nope"), undefined);
    assert.equal(sanitizeToolCallPayload({ messages: "nope" }), undefined);
  });

  it("keeps the unregistered rule off by default and on by option", () => {
    const payload = basePayload();
    (payload.messages as unknown[]).push(
      assistant([call("b", "nonexistent_tool")]),
      toolResult("b"),
    );

    // Default: only empty names are dropped, so this stays as-is.
    assert.equal(sanitizeToolCallPayload(payload), undefined);

    const result = sanitizeToolCallPayload(payload, { dropUnregistered: true });
    assert.ok(result);
    assert.deepEqual(
      result.report.droppedCalls.map((c) => c.reason),
      ["unregistered"],
    );
    const { messages } = result.payload as {
      messages: Record<string, unknown>[];
    };
    assert.equal(
      messages.length,
      4,
      "only system/user/healthy exchange remain",
    );
    assert.ok(
      !messages.some((m) => m.role === "tool" && m.tool_call_id === "b"),
      "the orphan tool result must go with the dropped call",
    );
  });

  it("never applies the unregistered rule when tools is missing or empty", () => {
    for (const tools of [undefined, []]) {
      const payload: Record<string, unknown> = {
        model: "m",
        messages: [assistant([call("a", "whatever_tool")]), toolResult("a")],
        ...(tools === undefined ? {} : { tools }),
      };
      assert.equal(
        sanitizeToolCallPayload(payload, { dropUnregistered: true }),
        undefined,
        `tools=${JSON.stringify(tools)} must not trigger the rule`,
      );
    }
  });

  it("drops an assistant message left with neither content nor tool calls", () => {
    const payload: Record<string, unknown> = {
      model: "m",
      messages: [
        { role: "user", content: "hi" },
        assistant([call("a", "")]), // only call, no content
        assistant([call("b", "")], "still talking"), // has content
      ],
      tools: [{ type: "function", function: { name: "bash" } }],
    };

    const result = sanitizeToolCallPayload(payload);
    assert.ok(result);
    const { messages } = result.payload as {
      messages: Record<string, unknown>[];
    };
    assert.equal(messages.length, 2, "the empty assistant message is gone");
    assert.equal(result.report.droppedAssistantMessages, 1);
    const survivor = messages[1] as Record<string, unknown>;
    assert.equal(survivor.content, "still talking");
    assert.equal(survivor.tool_calls, undefined, "tool_calls key removed");
  });

  it("keeps prose when only some calls of a message are dropped", () => {
    const payload: Record<string, unknown> = {
      model: "m",
      messages: [assistant([call("a", "bash"), call("b", "")], "working")],
      tools: [{ type: "function", function: { name: "bash" } }],
    };
    const result = sanitizeToolCallPayload(payload);
    assert.ok(result);
    const message = (result.payload as { messages: Record<string, unknown>[] })
      .messages[0];
    assert.equal(message.content, "working");
    assert.equal((message.tool_calls as unknown[]).length, 1);
  });

  it("drops a tool_choice naming a function that is no longer declared", () => {
    const payload = basePayload();
    payload.tool_choice = {
      type: "function",
      function: { name: "ghost_tool" },
    };
    (payload.messages as unknown[]).push(
      assistant([call("a", "bash"), call("b", "")]),
      toolResult("b"),
    );

    const result = sanitizeToolCallPayload(payload);
    assert.ok(result);
    assert.equal(result.report.toolChoiceDropped, true);
    assert.equal(
      (result.payload as { tool_choice?: unknown }).tool_choice,
      undefined,
    );
  });

  it("keeps a valid named tool_choice", () => {
    const payload = basePayload();
    payload.tool_choice = { type: "function", function: { name: "bash" } };
    (payload.messages as unknown[]).push(assistant([call("b", "")]));
    const result = sanitizeToolCallPayload(payload);
    assert.ok(result);
    assert.equal(result.report.toolChoiceDropped, false);
    assert.deepEqual((result.payload as { tool_choice: unknown }).tool_choice, {
      type: "function",
      function: { name: "bash" },
    });
  });

  it("drops tool results with a missing or unknown tool_call_id", () => {
    const payload: Record<string, unknown> = {
      model: "m",
      messages: [
        assistant([call("a", "bash")]),
        toolResult("a"),
        { role: "tool", content: "orphan", tool_call_id: "never-declared" },
        { role: "tool", content: "no id at all" },
      ],
      tools: [{ type: "function", function: { name: "bash" } }],
    };
    const result = sanitizeToolCallPayload(payload);
    assert.ok(result);
    assert.deepEqual(result.report.droppedToolResults, [
      "never-declared",
      "<missing>",
    ]);
    const roles = (result.payload as { messages: Record<string, unknown>[] })
      .messages;
    assert.equal(roles.length, 2);
  });

  it("reports the message-count delta", () => {
    const payload = basePayload();
    (payload.messages as unknown[]).push(
      assistant([call("b", "bash"), call("c", "")]),
      toolResult("c"),
    );
    const result = sanitizeToolCallPayload(payload);
    assert.ok(result);
    const report: SanitizeReport = result.report;
    assert.equal(report.messagesBefore, 6);
    assert.equal(report.messagesAfter, 5);
    assert.equal(report.droppedCalls.length, 1);
    assert.equal(report.droppedToolResults.length, 1);
  });

  it("accepts the custom (grammar) tool-call shape", () => {
    const payload: Record<string, unknown> = {
      model: "m",
      messages: [
        assistant([
          { id: "x", type: "custom", custom: { name: "bash", input: {} } },
          { id: "y", type: "custom", custom: { name: "", input: {} } },
        ]),
        { role: "tool", content: "ok", tool_call_id: "y" },
      ],
      tools: [{ type: "custom", custom: { name: "bash" } }],
    };
    const result = sanitizeToolCallPayload(payload, { dropUnregistered: true });
    assert.ok(result);
    assert.deepEqual(
      result.report.droppedCalls.map((c) => c.reason),
      ["empty_name"],
    );
  });
});

describe("createToolCallSanitizerExtension", () => {
  it("replaces the payload and reports once per real change", () => {
    const reports: SanitizeReport[] = [];
    const { pi, handlers } = fakePi();
    createToolCallSanitizerExtension({ onSanitized: (r) => reports.push(r) })(
      pi,
    );

    const payload: Record<string, unknown> = {
      model: "m",
      messages: [assistant([call("a", "")])],
      tools: [{ type: "function", function: { name: "bash" } }],
    };

    const replaced = handlers[0]({ payload });
    assert.ok(replaced, "handler must return the sanitized payload");
    assert.equal(reports.length, 1);
    assert.equal(
      (replaced as { messages: unknown[] }).messages.length,
      0,
      "the empty assistant message is dropped",
    );

    // A clean payload: handler returns undefined (no change, no report).
    assert.equal(handlers[0]({ payload: basePayload() }), undefined);
    assert.equal(reports.length, 1, "no report when nothing changed");
  });

  it("never throws: a sanitize failure passes the payload through", () => {
    const { pi, handlers } = fakePi();
    createToolCallSanitizerExtension()(pi);

    // `messages` is an array-like object whose iterator throws.
    const payload = {
      model: "m",
      tools: [{ type: "function", function: { name: "bash" } }],
      messages: {
        length: 1,
        0: { role: "assistant", tool_calls: [call("a", "")] },
        *[Symbol.iterator]() {
          throw new Error("boom");
        },
      },
    };
    assert.equal(handlers[0]({ payload }), undefined);
  });
});
