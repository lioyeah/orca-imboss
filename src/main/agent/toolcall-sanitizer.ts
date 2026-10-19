/**
 * Provider-payload sanitizer for malformed tool calls.
 *
 * Why this exists
 * ---------------
 * A model turn can emit a structurally malformed tool call. One real case is on
 * record (see `scripts/private/ops/004-employee4-session-poison.md`): the
 * assistant message carried two tool calls, the second with an **empty**
 * `function.name` and a `call_`-prefixed id — a provider-side artifact rather
 * than a tool this app ever declared. The Pi runtime resolves it to
 * `"Tool  not found"`, persists both the call and that error result, and then
 * **replays them on every later request**. StepFun answers each replay with
 * `400 tool_calls.function.name is required`, so the turn dies before a single
 * token is spent and the session can never recover on its own.
 *
 * What this module does
 * ---------------------
 * Drops, from the **wire payload only**:
 * - assistant `tool_calls` whose `function.name` is empty/blank;
 * - assistant `tool_calls` whose name is not declared in `payload.tools`
 *   (only when that list is non-empty — see `dropUnregistered`);
 * - the orphan `role:"tool"` results those dropped calls produced;
 * - assistant messages left with neither content nor tool calls;
 * - a `tool_choice` that names a function no longer in the payload.
 *
 * Session history on disk is deliberately **not** touched: the poison is
 * replayed on every request, so cleaning the outgoing payload is enough to make
 * an already-poisoned session heal on its next turn, with no file surgery and
 * no parentId/id chain to repair.
 *
 * Contract
 * --------
 * - Pure: returns a **new** payload object, never mutates the input (the
 *   `before_provider_request` handler is chained with other extensions).
 * - Idempotent: a second pass over an already-clean payload returns
 *   `undefined`, so "sanitize then retry once" cannot loop.
 * - Silent when clean: no report (and therefore no log) when nothing was
 *   dropped.
 */

import type {
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

/** OpenAI chat-completions tool call as it appears on the wire. */
interface WireToolCall {
  id?: unknown;
  type?: unknown;
  function?: unknown;
  custom?: unknown;
}

/** A single message of the outgoing chat-completions `messages` array. */
type WireMessage = Record<string, unknown>;

/** The outgoing provider payload (chat-completions params). */
type WirePayload = Record<string, unknown>;

/** Why a tool call (or its result) was dropped. */
export type ToolCallDropReason =
  "empty_name" | "unregistered" | "orphan_tool_result" | "missing_tool_call_id";

export interface DroppedToolCall {
  /** The wire id of the dropped call ("" when the provider omitted it). */
  id: string;
  reason: ToolCallDropReason;
}

/** What one sanitize pass removed. Also the shape of the structured log. */
export interface SanitizeReport {
  droppedCalls: DroppedToolCall[];
  /** Wire ids of dropped `role:"tool"` messages. */
  droppedToolResults: string[];
  /** Assistant messages dropped for having neither content nor tool calls. */
  droppedAssistantMessages: number;
  messagesBefore: number;
  messagesAfter: number;
  /** True when an invalid named `tool_choice` was removed. */
  toolChoiceDropped: boolean;
}

export interface SanitizedPayload {
  payload: WirePayload;
  report: SanitizeReport;
}

export interface ToolCallSanitizeOptions {
  /**
   * Also drop calls whose name is not declared in `payload.tools`.
   *
   * Only applied when `payload.tools` is a non-empty array: a payload with an
   * empty tool list still carries tool history (Pi sends `tools: []` in that
   * case), and there is nothing to validate names against. Off by default
   * until the app's full tool surface — built-ins, MCP tools exposed
   * `direct`, and the team `imb_*` tools — is confirmed to be declared.
   */
  dropUnregistered?: boolean;
  /** Sink for the structured "payload sanitized" record. */
  onSanitized?: (report: SanitizeReport) => void;
}

/** Read a tool name from either the `function` or the `custom` wire shape. */
function wireToolName(entry: unknown): string {
  if (typeof entry !== "object" || entry === null) return "";
  const fn = (entry as WireToolCall).function;
  if (typeof fn === "object" && fn !== null) {
    const name = (fn as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  const custom = (entry as WireToolCall).custom;
  if (typeof custom === "object" && custom !== null) {
    const name = (custom as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

/** Read a tool call id ("" when absent or not a string). */
function wireToolCallId(call: unknown): string {
  if (typeof call !== "object" || call === null) return "";
  const id = (call as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

/**
 * Names declared in `payload.tools`, or `null` when there is no usable
 * declaration list (missing / not an array / empty) — in which case the
 * `unregistered` rule must not fire.
 */
function collectDeclaredToolNames(tools: unknown): Set<string> | null {
  if (!Array.isArray(tools) || tools.length === 0) return null;
  const names = new Set<string>();
  for (const tool of tools) {
    const name = wireToolName(tool).trim();
    if (name !== "") names.add(name);
  }
  return names;
}

/** An assistant message counts as empty when it has neither text nor blocks. */
function hasContent(content: unknown): boolean {
  if (typeof content === "string") return content.length > 0;
  if (Array.isArray(content)) return content.length > 0;
  return content !== null && content !== undefined;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Remove malformed tool calls from an outgoing provider payload.
 *
 * Returns `undefined` when the payload needs no change (also the idempotency
 * guarantee: running the result through again yields `undefined`).
 */
export function sanitizeToolCallPayload(
  payload: unknown,
  options: ToolCallSanitizeOptions = {},
): SanitizedPayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const wire = payload as WirePayload;
  if (!Array.isArray(wire.messages)) return undefined;

  const declared = collectDeclaredToolNames(wire.tools);
  const dropUnregistered = options.dropUnregistered === true;

  const droppedCalls: DroppedToolCall[] = [];
  const droppedToolResults: string[] = [];
  let droppedAssistantMessages = 0;
  // Ids of the tool calls that survive this pass; a `role:"tool"` message is
  // only valid when it answers one of them.
  const liveToolCallIds = new Set<string>();
  const messages: WireMessage[] = [];

  for (const raw of wire.messages) {
    if (typeof raw !== "object" || raw === null) continue;

    const message = raw as WireMessage;
    const role = message.role;

    if (role === "assistant" && Array.isArray(message.tool_calls)) {
      const original = message.tool_calls;
      const kept: unknown[] = [];
      for (const call of original) {
        const name = wireToolName(call).trim();
        if (name === "") {
          droppedCalls.push({ id: wireToolCallId(call), reason: "empty_name" });
          continue;
        }
        if (dropUnregistered && declared !== null && !declared.has(name)) {
          droppedCalls.push({
            id: wireToolCallId(call),
            reason: "unregistered",
          });
          continue;
        }
        kept.push(call);
        const id = wireToolCallId(call);
        if (id !== "") liveToolCallIds.add(id);
      }

      if (kept.length === original.length) {
        messages.push(message);
      } else if (kept.length > 0) {
        messages.push({ ...message, tool_calls: kept });
      } else if (hasContent(message.content)) {
        // Keep the prose, drop the (now empty) call list.
        const { tool_calls: _calls, ...rest } = message;
        messages.push(rest);
      } else {
        // Nothing left to say: an assistant message with neither content nor
        // tool calls is rejected by several providers.
        droppedAssistantMessages += 1;
      }
      continue;
    }

    if (role === "tool") {
      const id = stringOrEmpty(message.tool_call_id);
      if (id === "" || !liveToolCallIds.has(id)) {
        droppedToolResults.push(id === "" ? "<missing>" : id);
        continue;
      }
      messages.push(message);
      continue;
    }

    messages.push(message);
  }

  if (droppedCalls.length === 0 && droppedToolResults.length === 0) {
    return undefined;
  }

  const sanitized: WirePayload = { ...wire, messages };

  // A `tool_choice` naming a function that is no longer in the payload is
  // itself an invalid request; fall back to the provider default.
  let toolChoiceDropped = false;
  const choice = wire.tool_choice;
  if (declared !== null && typeof choice === "object" && choice !== null) {
    const named = wireToolName(choice).trim();
    if (named !== "" && !declared.has(named)) {
      delete sanitized.tool_choice;
      toolChoiceDropped = true;
    }
  }

  const report: SanitizeReport = {
    droppedCalls,
    droppedToolResults,
    droppedAssistantMessages,
    messagesBefore: wire.messages.length,
    messagesAfter: messages.length,
    toolChoiceDropped,
  };
  return { payload: sanitized, report };
}

/**
 * Extension factory that sanitizes every outgoing provider payload.
 *
 * Registered next to the MCP extension in `session.ts`. The handler is written
 * to be incapable of breaking a request: the Pi extension runner catches
 * handler exceptions and then **passes the original payload through**, so a
 * throw here would silently disable sanitization. Everything therefore happens
 * inside a try/catch that logs and returns `undefined` (= "no change").
 */
export function createToolCallSanitizerExtension(
  options: ToolCallSanitizeOptions = {},
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("before_provider_request", (event) => {
      let result: SanitizedPayload | undefined;
      try {
        result = sanitizeToolCallPayload(event.payload, options);
      } catch (error) {
        console.error(
          "[toolcall-sanitizer] sanitize failed; sending payload unchanged",
          error,
        );
        return undefined;
      }
      if (result === undefined) return undefined;
      const report = result.report;
      if (options.onSanitized) {
        options.onSanitized(report);
      } else {
        console.log("[toolcall-sanitizer] tool_call_sanitized", report);
      }
      return result.payload;
    });
  };
}
