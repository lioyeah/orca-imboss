/**
 * Minimal MCP server over stdio for the headless daemon.
 *
 * Purpose (spike): prove that a remote/agent client can drive the core without
 * the GUI. It implements just enough of the Model Context Protocol to be usable
 * by any MCP client: `initialize`, `tools/list`, `tools/call` and `ping`, with
 * newline-delimited JSON-RPC 2.0 on stdin/stdout.
 *
 * IMPORTANT: stdout is reserved for protocol traffic. Every diagnostic goes to
 * stderr.
 *
 * The tool set is deliberately small and read-mostly; a real gateway would grow
 * it (and would need authentication + a curated subset of the IPC surface).
 */

import { ASSISTANT_ID } from "@shared/constants/employees";
import { listChatSummaries } from "../main/db/chats";
import { createChat } from "../main/db/chats";
import { appendMessage, listMessages } from "../main/db/messages";
import { deliver } from "../main/agent/session-queue";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "imboss-daemon", version: "0.1.0-spike" };
const MAX_MESSAGES = 50;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "imboss_list_chats",
    description:
      "List the boss's chats (id, title, unread, last activity). Use this first to find a chat id.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "imboss_create_chat",
    description:
      "Create a new chat between the boss and the Assistant. Returns the new chat id.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Chat title (may be empty)." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "imboss_read_messages",
    description:
      "Read the most recent messages of one chat, oldest first. Returns sender, kind and text.",
    inputSchema: {
      type: "object",
      properties: {
        chatId: { type: "number", description: "Chat id from imboss_list_chats." },
        limit: {
          type: "number",
          description: `How many messages to return (max ${MAX_MESSAGES}).`,
        },
      },
      required: ["chatId"],
      additionalProperties: false,
    },
  },
  {
    name: "imboss_send_message",
    description:
      "Send a message into a chat as the boss. The Assistant is woken to act on it.",
    inputSchema: {
      type: "object",
      properties: {
        chatId: { type: "number", description: "Chat id from imboss_list_chats." },
        text: { type: "string", description: "Message text." },
      },
      required: ["chatId", "text"],
      additionalProperties: false,
    },
  },
];

function text(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function requireChatId(params: Record<string, unknown> | undefined): number {
  const raw = params?.["chatId"];
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new Error("chatId must be an integer.");
  }
  return raw;
}

function callTool(
  name: string,
  params: Record<string, unknown> | undefined,
): unknown {
  switch (name) {
    case "imboss_list_chats": {
      return listChatSummaries().map((chat) => ({
        id: chat.id,
        title: chat.title,
        unread: chat.unread,
        lastMessageAt: chat.lastMessageAt,
      }));
    }
    case "imboss_create_chat": {
      const raw = params?.["title"];
      const title = typeof raw === "string" ? raw.trim() : "";
      const chat = createChat(title, [ASSISTANT_ID]);
      return { chatId: chat.id, title: chat.title };
    }
    case "imboss_read_messages": {
      const chatId = requireChatId(params);
      const rawLimit = params?.["limit"];
      const limit =
        typeof rawLimit === "number" && Number.isInteger(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, MAX_MESSAGES)
          : 20;
      const all = listMessages(chatId);
      return all.slice(-limit).map((message) => ({
        id: message.id,
        senderEmployeeId: message.senderEmployeeId,
        kind: message.kind,
        text: message.content,
        createdAt: message.createdAt,
        attachments: (message.attachments ?? []).map((a) => a.name),
      }));
    }
    case "imboss_send_message": {
      const chatId = requireChatId(params);
      const raw = params?.["text"];
      const body = typeof raw === "string" ? raw.trim() : "";
      if (body.length === 0) throw new Error("text must be a non-empty string.");
      const message = appendMessage(chatId, null, body);
      // Wake the Assistant for this chat, exactly like the GUI's `chat:send`.
      void deliver(ASSISTANT_ID, chatId, body);
      return { messageId: message.id, chatId, delivered: true };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Start serving MCP on stdio. Returns a handle that stops reading. */
export function startMcpStdioServer(): { close(): void; toolCount: number } {
  let buffer = "";
  let closed = false;

  const write = (payload: unknown): void => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  const reply = (id: number | string | null | undefined, result: unknown): void => {
    write({ jsonrpc: "2.0", id: id ?? null, result });
  };

  const replyError = (
    id: number | string | null | undefined,
    code: number,
    message: string,
  ): void => {
    write({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  };

  const handle = (request: JsonRpcRequest): void => {
    const { id, method, params } = request;
    switch (method) {
      case "initialize":
        reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        return; // notifications: no response
      case "ping":
        reply(id, {});
        return;
      case "tools/list":
        reply(id, { tools: TOOLS });
        return;
      case "tools/call": {
        const name = typeof params?.["name"] === "string" ? params["name"] : "";
        const args =
          typeof params?.["arguments"] === "object" && params["arguments"] !== null
            ? (params["arguments"] as Record<string, unknown>)
            : undefined;
        try {
          const result = callTool(name, args);
          reply(id, { content: [{ type: "text", text: text(result) }] });
        } catch (err) {
          // Tool failures are results, not protocol errors (per MCP).
          reply(id, {
            content: [
              {
                type: "text",
                text: err instanceof Error ? err.message : String(err),
              },
            ],
            isError: true,
          });
        }
        return;
      }
      default:
        if (id !== undefined && id !== null) {
          replyError(id, -32601, `Method not found: ${method}`);
        }
    }
  };

  const onData = (chunk: Buffer): void => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) {
        try {
          handle(JSON.parse(line) as JsonRpcRequest);
        } catch (err) {
          console.error(
            "[daemon:mcp] invalid request:",
            err instanceof Error ? err.message : err,
          );
        }
      }
      index = buffer.indexOf("\n");
    }
  };

  process.stdin.on("data", onData);
  process.stdin.on("end", () => {
    closed = true;
  });

  return {
    toolCount: TOOLS.length,
    close(): void {
      if (closed) return;
      closed = true;
      process.stdin.removeListener("data", onData);
    },
  };
}
