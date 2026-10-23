import { READ_CHAT_PROMPT } from "@shared/constants/prompts";
import { ipcMain, shell } from "electron";
import { existsSync } from "fs";
import { isAbsolute } from "path";
import { wakeAgent } from "../agent/session-queue";
import * as dbMessages from "../db/messages";
import { agentPrompt, validateAttachmentsPayload } from "./attachment-prompt";
import { assertInteger, assertObject, assertString } from "./helpers";

export function registerMessageHandlers(): void {
  ipcMain.handle("messages:list", (_event, chatId: unknown) =>
    dbMessages.listMessages(assertInteger(chatId, "chat id")),
  );

  ipcMain.handle("messages:search", (_event, query: unknown) =>
    dbMessages.searchMessages(assertString(query, "query")),
  );

  ipcMain.handle(
    "messages:append",
    (_event, chatId: unknown, senderEmployeeId: unknown, content: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeSender =
        senderEmployeeId === null
          ? null
          : assertInteger(senderEmployeeId, "sender id");
      return dbMessages.appendMessage(
        safeChatId,
        safeSender,
        assertString(content, "content"),
      );
    },
  );

  // Human (or any renderer) answers an ask message: append a kind=`answer`
  // system message and wake the ask's sender agent so it can react.
  //
  // `attachments` are the files the boss attached to this answer. They live on
  // the message row (like every other kind's attachments) and never inside the
  // answers JSON: the JSON is parsed by the card, the preview and the search
  // index, and duplicating binary metadata there would only create a second
  // source of truth. Field-level validation stays in the messages service.
  ipcMain.handle(
    "messages:answer",
    (
      _event,
      chatId: unknown,
      askMessageId: unknown,
      answers: unknown,
      attachments: unknown,
    ) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeAskId = assertInteger(askMessageId, "ask message id");
      const safeAttachments = validateAttachmentsPayload(attachments);
      const ask = dbMessages.getMessageById(safeAskId);
      if (!ask || ask.chatId !== safeChatId || ask.kind !== "ask") {
        throw new Error("Ask message does not exist.");
      }
      // Stamp the answer with the ask it replies to so the card can rehydrate
      // its retained options/text after a reload. Set after the spread so a
      // renderer-supplied `askMessageId` can never override it.
      const payload = {
        ...assertObject(answers, "answers"),
        askMessageId: safeAskId,
      };
      const message = dbMessages.appendMessage(
        safeChatId,
        null,
        JSON.stringify(payload),
        {
          kind: "answer",
          ...(safeAttachments && safeAttachments.length > 0
            ? { attachments: safeAttachments }
            : {}),
        },
      );
      if (ask.senderEmployeeId != null) {
        // `wakeAgent` redirects the assistant (id 0) from a task group chat to
        // its root-chat session. The boss's answer is human-triggered: steer a
        // mid-run session instead of queueing (idle sessions queue as before).
        // The attachment list rides along so the model opens the files instead
        // of replying "got it" without reading them (`imb_read_chat` would also
        // carry them, this just makes it impossible to miss).
        void wakeAgent(
          ask.senderEmployeeId,
          safeChatId,
          agentPrompt(READ_CHAT_PROMPT, safeAttachments),
          { mode: "steer" },
        );
      }
      return message;
    },
  );

  // Reveal a message attachment in the OS file manager. The renderer only
  // passes the message id + index; the path is read from the trusted stored
  // record so a compromised renderer can never reveal arbitrary paths.
  ipcMain.handle(
    "messages:revealAttachment",
    async (_event, messageId: unknown, index: unknown) => {
      const attachment = resolveAttachment(messageId, index);
      const path = attachment.path;
      if (!path) throw new Error("Attachment location is unavailable.");
      if (!isAbsolute(path)) {
        throw new Error("Attachment location is invalid.");
      }
      if (!existsSync(path)) {
        throw new Error("Attachment file no longer exists.");
      }
      if (attachment.kind === "folder") {
        // Open the folder itself; `showItemInFolder` would only select it in
        // its parent. `openPath` resolves to an error string ("" on success).
        const error = await shell.openPath(path);
        if (error) throw new Error(error);
        return;
      }
      shell.showItemInFolder(path);
    },
  );
}

/**
 * Resolve an attachment by message id + index from the trusted stored record.
 * Shared by the reveal and preview handlers so both enforce the same bounds
 * checks; throws when the message/attachment does not exist.
 */
function resolveAttachment(
  messageId: unknown,
  index: unknown,
): {
  name: string;
  type: string;
  path?: string;
  kind?: "file" | "folder" | "chat";
} {
  const safeId = assertInteger(messageId, "message id");
  const safeIndex = assertInteger(index, "attachment index");
  if (safeIndex < 0) {
    throw new Error("Attachment index must be non-negative.");
  }
  const message = dbMessages.getMessageById(safeId);
  if (!message) throw new Error("Message does not exist.");
  const attachments = message.attachments;
  if (!attachments || safeIndex >= attachments.length) {
    throw new Error("Attachment does not exist.");
  }
  return attachments[safeIndex];
}
