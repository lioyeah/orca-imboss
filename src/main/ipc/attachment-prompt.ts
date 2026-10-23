/**
 * Attachment → prompt/text helpers shared by the IPC handlers that deliver a
 * message carrying files to an agent (`chat:send`, `messages:answer`).
 *
 * Keeping them in one module means "how an attachment is described to the
 * model" has exactly one implementation: a second copy would drift, and the
 * model would read one of the two paths differently.
 */
import type { MessageAttachment } from "@shared/types";
import { isAbsolute } from "path";

/** Typed view of the renderer-supplied attachments payload. */
export function validateAttachmentsPayload(
  value: unknown,
): MessageAttachment[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("attachments must be an array.");
  // Field-level validation happens in the messages service; pass through and
  // let it throw on malformed entries.
  return value as MessageAttachment[];
}

/** Cap for a name/type/path embedded in the agent prompt (matches the DB limits). */
const MAX_PROMPT_ATTACH_NAME_LENGTH = 256;
const MAX_PROMPT_ATTACH_TYPE_LENGTH = 128;
const MAX_PROMPT_ATTACH_PATH_LENGTH = 4096;

/**
 * Collapse control characters (notably newlines) and cap length so an
 * attachment name/path can never forge extra lines in the agent prompt.
 */
export function sanitizePromptField(value: string, maxLength: number): string {
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}…`
    : cleaned;
}

/** Human-readable byte size for the agent prompt (mirrors the bubble chip). */
function formatPromptSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Agent-facing description of the user's attachments. Only absolute paths are
 * embedded (a relative path is useless outside the agent's workdir, mirroring
 * the reveal IPC's `isAbsolute` guard); the rest degrade to name/type/size.
 */
export function formatAttachmentBlock(
  attachments: MessageAttachment[] | undefined,
): string {
  if (!attachments || attachments.length === 0) return "";
  const lines = attachments.map((attachment) => {
    const name =
      sanitizePromptField(attachment.name, MAX_PROMPT_ATTACH_NAME_LENGTH) ||
      "file";
    // A conversation attachment is a reference, not a file: give the model the
    // chat id and tell it how to read the whole thing (uncursored).
    if (
      attachment.kind === "chat" &&
      typeof attachment.chatId === "number" &&
      attachment.chatId > 0
    ) {
      return `- [conversation] ${name} — chat #${attachment.chatId}: read it in full with imb_read_chat (chatId: ${attachment.chatId}, full: true)`;
    }
    // A folder is a location the model reads in place, not a file to open: say
    // so, otherwise "- docs (folder, 0 B)" reads like an empty file.
    const absolutePath =
      typeof attachment.path === "string" &&
      attachment.path.length > 0 &&
      isAbsolute(attachment.path)
        ? sanitizePromptField(attachment.path, MAX_PROMPT_ATTACH_PATH_LENGTH)
        : "";
    if (attachment.kind === "folder") {
      return absolutePath.length > 0
        ? `- [folder] ${name} — directory at ${absolutePath}: list/read files inside it with your filesystem tools (its contents are not attached individually)`
        : `- [folder] ${name} — directory location unavailable`;
    }
    const type =
      sanitizePromptField(attachment.type, MAX_PROMPT_ATTACH_TYPE_LENGTH) ||
      "unknown type";
    const base = `- ${name} (${type}, ${formatPromptSize(attachment.size)})`;
    return absolutePath.length > 0 ? `${base}: ${absolutePath}` : base;
  });
  return `[Attachments]\n${lines.join("\n")}`;
}

/**
 * Prompt delivered to the agent: the raw text plus a compact attachment list,
 * so the model immediately knows where the files live.
 *
 * Used for a user send (text + files) and for the wake prompt after the boss
 * answers an ask card with files attached — in the latter case `content` is the
 * generic "read the chat" prompt, and the list is what stops the model from
 * replying "got it" without ever opening the attached file.
 */
export function agentPrompt(
  content: string,
  attachments: MessageAttachment[] | undefined,
): string {
  const block = formatAttachmentBlock(attachments);
  if (block.length === 0) return content;
  return content.length > 0 ? `${content}\n\n${block}` : block;
}

/**
 * Stored content for a user message. Attachments without text get a neutral
 * file-name list instead of the former hardcoded `"[附件]"`; `appendMessage`
 * rejects empty content.
 */
export function userMessageContent(
  content: string,
  attachments: MessageAttachment[] | undefined,
): string {
  if (content.length > 0) return content;
  const names = (attachments ?? [])
    .map((attachment) =>
      sanitizePromptField(attachment.name, MAX_PROMPT_ATTACH_NAME_LENGTH),
    )
    .filter((name) => name.length > 0);
  return names.length > 0 ? `Attached: ${names.join(", ")}` : "Attached files";
}
