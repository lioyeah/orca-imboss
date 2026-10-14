import { t } from "@shared/l10n";
import type {
  MessageAttachment,
  RemoteAgent,
  RemoteAgentInput,
} from "@shared/types";
import * as dbMessages from "../db/messages";
import * as dbRemote from "../db/remote-agents";
import { normalizeRemoteUrl, resolveRemoteCard } from "./card";
import { sendToRemoteAgent, type RemoteTaskState } from "./client";
import { loadRemoteAgentSecrets, setToken, tokenFor } from "./store";

/**
 * Bridge between an imboss conversation and a remote A2A peer.
 *
 * The user writes in the peer's chat; `send()` streams the peer's answer back
 * into that chat as messages authored by the peer's hidden employee row. State
 * changes the chat cannot render as content (failure, waiting for input) are
 * posted as short `remote-status` notes.
 *
 * There is no server side here: Phase 1 is client-only, so a peer is reachable
 * whenever its agent card URL is.
 */

/** Message kind for app-generated notes about a peer's task state. */
const STATUS_KIND = "remote-status";

/** Message kind for content the peer produced. */
const CONTENT_KIND = "text";

/** Caps applied to a peer's answer before it reaches the message table. */
const MAX_CONTENT = 100_000;

interface InFlightSend {
  chatId: number;
  controller: AbortController;
}

class RemoteAgentManager {
  private readonly inFlight = new Map<number, InFlightSend>();
  private nextSendId = 1;
  private started = false;

  /** Load the peer secrets file. Idempotent. */
  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await loadRemoteAgentSecrets();
  }

  /** Renderer snapshot of every peer. */
  list(): RemoteAgent[] {
    return dbRemote.listRemoteAgents().map(dbRemote.toRemoteAgentView);
  }

  /**
   * Add a peer: resolve its agent card, then create the peer, its hidden
   * employee row and its conversation in one transaction. A card that cannot
   * be resolved fails the add, so a peer is never stored in a broken state.
   */
  async add(input: RemoteAgentInput): Promise<RemoteAgent> {
    await this.init();
    const url = normalizeRemoteUrl(input.url);
    if (this.list().some((agent) => agent.url === url)) {
      throw new Error("This remote agent has already been added.");
    }
    const token = input.token?.trim() ?? "";
    const resolved = await resolveRemoteCard(
      url,
      token.length > 0 ? token : null,
    );
    const record = dbRemote.createRemoteAgent({
      url,
      card: resolved.card,
      name: resolved.name,
      role: resolved.description,
      status: "ok",
      statusDetail: null,
    });
    if (!record) throw new Error("Could not create the remote agent.");
    if (token.length > 0) await setToken(record.id, token);
    return dbRemote.toRemoteAgentView(record);
  }

  /** Delete a peer, its conversation and its hidden employee row. */
  async remove(id: number): Promise<boolean> {
    const record = dbRemote.getRemoteAgent(id);
    if (record) this.disposeForChat(record.chatId);
    const removed = dbRemote.deleteRemoteAgent(id);
    if (removed) await setToken(id, null);
    return removed;
  }

  /** Re-resolve the agent card and record the outcome. */
  async refresh(id: number): Promise<RemoteAgent> {
    await this.init();
    const record = dbRemote.getRemoteAgent(id);
    if (!record) throw new Error("Unknown remote agent.");
    try {
      const resolved = await resolveRemoteCard(record.url, tokenFor(id));
      dbRemote.updateRemoteAgentCard(id, resolved.card, "ok", null);
      dbRemote.renameRemoteAgentEmployee(
        record.employeeId,
        resolved.name,
        resolved.description,
      );
    } catch (err) {
      // Keep the last good card so the peer stays usable; only the status and
      // the detail change.
      dbRemote.updateRemoteAgentCard(
        id,
        record.card,
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
    const updated = dbRemote.getRemoteAgent(id);
    if (!updated) throw new Error("Unknown remote agent.");
    return dbRemote.toRemoteAgentView(updated);
  }

  /**
   * Send one user message to the peer owning `chatId` and post its answer.
   * Never throws: failures become a message in the conversation plus a peer
   * status, because the caller is the fire-and-forget `chat:send` path.
   */
  async send(
    chatId: number,
    text: string,
    attachments?: MessageAttachment[],
  ): Promise<void> {
    await this.init();
    const record = dbRemote.getRemoteAgentByChat(chatId);
    if (!record) {
      console.error(
        `[remote] chat ${chatId} is not bridged to a remote agent; dropping the send.`,
      );
      return;
    }
    if (record.card === null) {
      // The cached card is unusable (a corrupt row). The peer can still be
      // refreshed from Settings, so say so instead of failing silently.
      try {
        dbMessages.appendMessage(
          chatId,
          record.employeeId,
          t(
            "This remote agent has no usable agent card. Refresh it in Settings → Remote agents.",
          ),
          { kind: STATUS_KIND },
        );
      } catch (err) {
        console.error(
          `[remote] failed to report the missing card in chat ${chatId}:`,
          err instanceof Error ? err.message : err,
        );
      }
      return;
    }

    const sendId = this.nextSendId++;
    const controller = new AbortController();
    this.inFlight.set(sendId, { chatId, controller });

    let produced = false;
    const post = (body: string, kind: string, silent: boolean): void => {
      const capped =
        body.length > MAX_CONTENT ? `${body.slice(0, MAX_CONTENT)}…` : body;
      try {
        dbMessages.appendMessage(chatId, record.employeeId, capped, {
          kind,
          ...(silent ? { silent: true } : {}),
        });
      } catch (err) {
        console.error(
          `[remote] failed to store the peer's message in chat ${chatId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    };

    try {
      await sendToRemoteAgent({
        card: record.card,
        token: tokenFor(record.id),
        text: composePrompt(text, attachments),
        signal: controller.signal,
        handlers: {
          onContent: (body) => {
            produced = true;
            post(body, CONTENT_KIND, false);
          },
          onState: (state) => {
            const note = stateNote(state);
            if (note !== null) post(note, STATUS_KIND, false);
          },
        },
      });
      // A peer that failed its last refresh but just answered is healthy again.
      if (record.status !== "ok") {
        dbRemote.updateRemoteAgentCard(record.id, record.card, "ok", null);
      }
      if (!produced) {
        post(
          t("The remote agent finished without a reply."),
          STATUS_KIND,
          true,
        );
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[remote] send to peer ${record.id} failed:`, detail);
      dbRemote.updateRemoteAgentCard(record.id, record.card, "error", detail);
      post(
        t("The remote agent request failed: ${error}", { error: detail }),
        STATUS_KIND,
        false,
      );
    } finally {
      this.inFlight.delete(sendId);
    }
  }

  /** Abort every in-flight send for one conversation (chat deleted). */
  disposeForChat(chatId: number): void {
    for (const [sendId, entry] of this.inFlight) {
      if (entry.chatId !== chatId) continue;
      entry.controller.abort();
      this.inFlight.delete(sendId);
    }
  }

  /**
   * Peer ids bound to these conversations. Read *before* the chats are
   * deleted, so no peer is left without its conversation.
   */
  peerIdsForChats(chatIds: number[]): number[] {
    return dbRemote.remoteAgentIdsForChats(chatIds);
  }

  /** Abort every in-flight send (app quit). */
  disposeAll(): void {
    for (const entry of this.inFlight.values()) entry.controller.abort();
    this.inFlight.clear();
  }
}

/** A short, localized note for the states a chat should surface. */
function stateNote(state: RemoteTaskState): string | null {
  switch (state) {
    case "input-required":
      return t("The remote agent is waiting for your reply.");
    case "auth-required":
      return t("The remote agent requires authentication.");
    case "failed":
      return t("The remote agent reported a failure.");
    case "rejected":
      return t("The remote agent declined the request.");
    case "canceled":
      return t("The remote agent canceled the task.");
    default:
      // `submitted` / `working` / `completed` / `unknown` need no note: the
      // answer itself, or the no-reply fallback, already tells the story.
      return null;
  }
}

/**
 * Prompt sent to the peer. Attachments are named but not uploaded: an A2A
 * message carries content, and imboss files live on this machine, so the peer
 * is told what the user attached instead of being handed a broken path.
 */
function composePrompt(
  text: string,
  attachments: MessageAttachment[] | undefined,
): string {
  const body = text.trim();
  if (!attachments || attachments.length === 0) return body;
  const names = attachments
    .map((attachment) => attachment.name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) return body;
  const block = `[Attachments: ${names.join(", ")}]`;
  return body.length > 0 ? `${body}\n\n${block}` : block;
}

export const remoteAgentManager = new RemoteAgentManager();
