import {
  Role,
  TaskState,
  type AgentCard,
  type Message,
  type Part,
  type SendMessageRequest,
  type Task,
  type TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from "@a2a-js/sdk/client";
import { randomUUID } from "crypto";
import { authFetch } from "./card";

/**
 * A2A client for one remote peer.
 *
 * The card is cached in the database, so every send reuses it instead of
 * re-running discovery. Responses are normalized into two things the chat can
 * store: complete pieces of agent content, and task-state changes.
 *
 * Streaming is deliberately lossy in one direction: A2A artifact updates are
 * incremental (`append` / `lastChunk`), while an imboss message row is
 * append-only. Incremental chunks are therefore buffered per artifact id and
 * emitted once the artifact is complete.
 */

/** Normalized task state (the A2A enum flattened to strings). */
export type RemoteTaskState =
  | "submitted"
  | "working"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected"
  | "input-required"
  | "auth-required"
  | "unknown";

function mapState(state: TaskState): RemoteTaskState {
  switch (state) {
    case TaskState.TASK_STATE_SUBMITTED:
      return "submitted";
    case TaskState.TASK_STATE_WORKING:
      return "working";
    case TaskState.TASK_STATE_COMPLETED:
      return "completed";
    case TaskState.TASK_STATE_FAILED:
      return "failed";
    case TaskState.TASK_STATE_CANCELED:
      return "canceled";
    case TaskState.TASK_STATE_REJECTED:
      return "rejected";
    case TaskState.TASK_STATE_INPUT_REQUIRED:
      return "input-required";
    case TaskState.TASK_STATE_AUTH_REQUIRED:
      return "auth-required";
    default:
      return "unknown";
  }
}

/** Callbacks the caller implements to store what the peer produced. */
export interface RemoteStreamHandlers {
  /** A complete piece of agent content (a message, or a finished artifact). */
  onContent(text: string): void;
  /** The peer's task changed state. */
  onState(state: RemoteTaskState): void;
}

/** Flatten A2A message/artifact parts into chat-readable Markdown. */
function partsToText(parts: readonly Part[] | undefined): string {
  if (!parts) return "";
  const lines: string[] = [];
  for (const part of parts) {
    const content = part.content;
    if (content === undefined) continue;
    switch (content.$case) {
      case "text":
        lines.push(content.value);
        break;
      case "url":
        lines.push(
          `[${part.filename.length > 0 ? part.filename : content.value}](${content.value})`,
        );
        break;
      case "raw":
        lines.push(
          `[${part.filename.length > 0 ? part.filename : "file"}${
            part.mediaType.length > 0 ? ` · ${part.mediaType}` : ""
          }]`,
        );
        break;
      case "data":
        lines.push(
          `\`\`\`json\n${JSON.stringify(content.value, null, 2)}\n\`\`\``,
        );
        break;
    }
  }
  return lines.join("\n").trim();
}

/** Text of an agent message (user-role echoes are ignored). */
function agentMessageText(message: Message | undefined): string {
  if (!message || message.role !== Role.ROLE_AGENT) return "";
  return partsToText(message.parts);
}

/** Build a client for a cached agent card. */
function createClient(card: unknown, token: string | null) {
  const fetchImpl = authFetch(token);
  return new ClientFactory({
    transports: [
      new JsonRpcTransportFactory({ fetchImpl }),
      new RestTransportFactory({ fetchImpl }),
    ],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
  }).createFromAgentCard(card as AgentCard);
}

/**
 * Send one user message to a peer and stream its answer back.
 *
 * Resolves once the peer's task reaches a terminal state or the stream ends.
 * Rejects when the request itself fails (unreachable peer, rejected auth);
 * the caller turns that into a chat message and a peer status.
 */
export async function sendToRemoteAgent(options: {
  card: unknown;
  token: string | null;
  text: string;
  handlers: RemoteStreamHandlers;
  signal?: AbortSignal;
}): Promise<void> {
  const { card, token, text, handlers, signal } = options;
  const client = await createClient(card, token);

  const request: SendMessageRequest = {
    tenant: "",
    message: {
      messageId: randomUUID(),
      contextId: "",
      taskId: "",
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: "text", value: text },
          metadata: undefined,
          filename: "",
          mediaType: "text/plain",
        },
      ],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: undefined,
    metadata: undefined,
  };

  // Artifact chunks, buffered until the artifact is complete.
  const pendingArtifacts = new Map<string, string[]>();
  // Artifacts already delivered, so a task snapshot after an artifact update
  // (or vice versa) never posts the same artifact twice.
  const emittedArtifacts = new Set<string>();
  // A task snapshot repeats the status message that a status update already
  // carried; identical consecutive content is collapsed.
  let lastEmitted = "";
  const emitContent = (text: string): void => {
    const body = text.trim();
    if (body.length === 0 || body === lastEmitted) return;
    lastEmitted = body;
    handlers.onContent(body);
  };
  const flushArtifact = (artifactId: string): void => {
    const chunks = pendingArtifacts.get(artifactId);
    if (chunks === undefined) return;
    pendingArtifacts.delete(artifactId);
    emittedArtifacts.add(artifactId);
    emitContent(chunks.join(""));
  };

  const emitTask = (task: Task): void => {
    if (task.status) handlers.onState(mapState(task.status.state));
    for (const artifact of task.artifacts) {
      if (emittedArtifacts.has(artifact.artifactId)) continue;
      flushArtifact(artifact.artifactId);
      emittedArtifacts.add(artifact.artifactId);
      emitContent(partsToText(artifact.parts));
    }
    // A completed task may carry its answer in the status message instead of
    // an artifact (a plain message answer is not wrapped in a task at all).
    emitContent(agentMessageText(task.status?.message));
  };

  const emitStatusUpdate = (event: TaskStatusUpdateEvent): void => {
    if (event.status) handlers.onState(mapState(event.status.state));
    emitContent(agentMessageText(event.status?.message));
  };

  for await (const response of client.sendMessageStream(request, { signal })) {
    const payload = response.payload;
    if (payload === undefined) continue;
    switch (payload.$case) {
      case "task":
        emitTask(payload.value);
        break;
      case "statusUpdate":
        emitStatusUpdate(payload.value);
        break;
      case "artifactUpdate": {
        const { artifact, append, lastChunk } = payload.value;
        if (artifact === undefined) break;
        const body = partsToText(artifact.parts);
        const chunks = pendingArtifacts.get(artifact.artifactId) ?? [];
        // `append: false` restarts the artifact (a replaced chunk).
        const next = append ? [...chunks, body] : [body];
        pendingArtifacts.set(artifact.artifactId, next);
        if (lastChunk) flushArtifact(artifact.artifactId);
        break;
      }
      case "message": {
        emitContent(agentMessageText(payload.value));
        break;
      }
    }
  }

  // A stream that ended without a `lastChunk` still has to deliver what it
  // sent, so nothing is silently dropped.
  for (const artifactId of [...pendingArtifacts.keys()]) {
    flushArtifact(artifactId);
  }
}
