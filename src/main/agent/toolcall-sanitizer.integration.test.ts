import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createToolCallSanitizerExtension } from "./toolcall-sanitizer.ts";

/**
 * Integration test for the tool-call sanitizer at its real wiring point.
 *
 * A throwaway OpenAI-compatible provider serves a poisoned history (an
 * assistant `tool_calls` entry with an empty `function.name`, exactly the
 * shape that made StepFun answer `tool_calls.function.name is required`),
 * and the assertions run against the provider requests the Pi agent actually
 * sends — not against a hand-built payload.
 *
 * Everything is ephemeral: an OS-assigned port, a temp agent dir, and an
 * in-memory session. Nothing touches the live app's `~/.imboss`.
 */

const POISON_CALL_ID = "call_poison_empty_name";
const POISON_CALL_NAME = "";

type ProviderRequestBody = {
  model?: string;
  messages?: Array<Record<string, unknown>>;
  tools?: unknown[];
  tool_choice?: unknown;
};

/** One scripted turn of the stub provider, replayed in order. */
type StubTurn = "empty-name-tool-call" | "text";

async function startStubProvider(
  turns: StubTurn[],
): Promise<{
  baseUrl: string;
  requests: ProviderRequestBody[];
  close: () => Promise<void>;
}> {
  const requests: ProviderRequestBody[] = [];
  let turn = 0;

  const server: Server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unexpected request" } }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        requests.push({});
      }
      const scripted = turns[Math.min(turn, turns.length - 1)];
      turn += 1;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.end(scriptedTurnBody(scripted));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("stub provider did not bind a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** SSE body for one turn, in the OpenAI chat-completions streaming shape. */
function scriptedTurnBody(turn: StubTurn): string {
  const chunk = (delta: unknown, finishReason: string | null): string =>
    `data: ${JSON.stringify({
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1,
      model: "stub-model",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;

  if (turn === "empty-name-tool-call") {
    return (
      chunk(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: POISON_CALL_ID,
              type: "function",
              function: { name: POISON_CALL_NAME, arguments: "{}" },
            },
          ],
        },
        null,
      ) +
      chunk({}, "tool_calls") +
      "data: [DONE]\n\n"
    );
  }
  return (
    chunk({ role: "assistant", content: "done" }, null) +
    chunk({}, "stop") +
    "data: [DONE]\n\n"
  );
}

/** Run one prompt against the stub provider, returning the captured requests. */
async function runScenario(options: {
  sanitize: boolean;
  customTools?: ToolDefinition[];
  /** Explicit tool allowlist; omitted = the SDK default (base built-ins). */
  tools?: string[];
}): Promise<ProviderRequestBody[]> {
  const stub = await startStubProvider(["empty-name-tool-call", "text"]);
  const dir = await mkdtemp(join(tmpdir(), "imboss-toolcall-sanitize-"));
  try {
    await writeFile(
      join(dir, "auth.json"),
      JSON.stringify({ stub: { type: "api_key", key: "test-key" } }),
      "utf8",
    );
    await writeFile(
      join(dir, "models.json"),
      JSON.stringify({
        providers: {
          stub: {
            baseUrl: stub.baseUrl,
            api: "openai-completions",
            models: [
              {
                id: "stub-model",
                name: "stub-model",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128_000,
                maxTokens: 8192,
              },
            ],
          },
        },
      }),
      "utf8",
    );

    const modelRuntime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
    });
    const model = modelRuntime.getModel("stub", "stub-model");
    assert.ok(model, "stub model must resolve from models.json");

    const settingsManager = SettingsManager.create(dir, dir);
    const resourceLoader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      // The real wiring point: `extensionFactories` is a resource-loader
      // option, exactly where the app passes `mcpExtension`.
      ...(options.sanitize
        ? { extensionFactories: [createToolCallSanitizerExtension()] }
        : {}),
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      modelRuntime,
      model,
      resourceLoader,
      sessionManager: SessionManager.inMemory(dir),
      settingsManager,
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.customTools ? { customTools: options.customTools } : {}),
    });

    await session.prompt("hello");
    await dispose(session);
    return stub.requests;
  } finally {
    await stub.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function dispose(session: AgentSession): Promise<void> {
  const maybe = session as unknown as { dispose?: () => Promise<void> | void };
  if (typeof maybe.dispose === "function") await maybe.dispose();
}

/** Names of every assistant tool call in a provider request. */
function toolCallNames(request: ProviderRequestBody): string[] {
  const names: string[] = [];
  for (const message of request.messages ?? []) {
    const calls = message.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      const fn = (call as { function?: { name?: unknown } }).function;
      names.push(typeof fn?.name === "string" ? fn.name : String(fn?.name));
    }
  }
  return names;
}

/** tool_call_ids answered by a `role:"tool"` message. */
function answeredToolCallIds(request: ProviderRequestBody): string[] {
  return (request.messages ?? [])
    .filter((m) => m.role === "tool")
    .map((m) => String(m.tool_call_id ?? "<missing>"));
}

/** tool_call_ids declared by assistant messages. */
function declaredToolCallIds(request: ProviderRequestBody): Set<string> {
  const ids = new Set<string>();
  for (const message of request.messages ?? []) {
    const calls = message.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      const id = (call as { id?: unknown }).id;
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

describe("tool-call sanitizer integration", () => {
  it(
    "reproduces the bug: the empty-name call and its orphan result reach the provider",
    { timeout: 60_000 },
    async () => {
      const requests = await runScenario({ sanitize: false, tools: [] });
      assert.equal(requests.length, 2, "one tool-call turn + one text turn");

      const replay = requests[1];
      // Both halves of the malformed exchange are replayed verbatim: the
      // provider sees `function.name: ""` again and rejects the whole request.
      assert.ok(
        toolCallNames(replay).includes(POISON_CALL_NAME),
        "without the sanitizer the empty-name call is replayed verbatim",
      );
      assert.ok(
        answeredToolCallIds(replay).includes(POISON_CALL_ID),
        "the failed tool result is replayed alongside it",
      );
    },
  );

  it(
    "fixes it: neither the empty-name call nor the orphan result reach the provider",
    { timeout: 60_000 },
    async () => {
      const requests = await runScenario({ sanitize: true, tools: [] });
      assert.equal(requests.length, 2, "one tool-call turn + one text turn");

      const replay = requests[1];
      assert.ok(
        !toolCallNames(replay).some((name) => name.trim() === ""),
        `no empty-name tool call may be sent, got ${JSON.stringify(toolCallNames(replay))}`,
      );
      const declared = declaredToolCallIds(replay);
      const orphans = answeredToolCallIds(replay).filter(
        (id) => !declared.has(id),
      );
      assert.deepEqual(
        orphans,
        [],
        "no tool result may outlive its declaration",
      );
      assert.deepEqual(
        toolCallNames(replay),
        [],
        "the whole poisoned turn is gone",
      );
    },
  );

  // Spec 待验①: the `unregistered` rule (off by default) may only ever be
  // enabled if `params.tools` really carries every tool the app can register.
  // The app's shell/team `imb_*` tools travel through the same `customTools`
  // path as this probe, so proving that path is proving the rule's premise.
  it(
    "params.tools carries app-registered custom tools alongside the built-ins",
    { timeout: 60_000 },
    async () => {
      const requests = await runScenario({
        sanitize: false,
        // default loadout: base built-ins + the registered custom tool
        customTools: [
          {
            name: "imb_probe_tool",
            label: "Probe",
            description: "probe tool for coverage assertions",
            parameters: Type.Object({}),
            execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
          } satisfies ToolDefinition,
        ],
      });

      const wireToolNames = toolNamesInToolsParam(requests[0]);
      assert.ok(
        wireToolNames.includes("imb_probe_tool"),
        `custom tools must be declared to the provider, got ${JSON.stringify(wireToolNames)}`,
      );
      assert.ok(
        wireToolNames.includes("read") && wireToolNames.includes("bash"),
        "built-in tools are declared too",
      );
    },
  );
});

/** Names of the tools declared in a provider request's `tools` param. */
function toolNamesInToolsParam(request: ProviderRequestBody): string[] {
  const names: string[] = [];
  for (const tool of request.tools ?? []) {
    const fn = (tool as { function?: { name?: unknown } }).function;
    if (typeof fn?.name === "string") names.push(fn.name);
  }
  return names;
}
