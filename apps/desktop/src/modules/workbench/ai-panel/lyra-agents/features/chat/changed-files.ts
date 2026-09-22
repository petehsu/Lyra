import type { ChatMessage, DiffHunk } from "../../core/types";

export const CHANGED_FILES_PREVIEW_LIMIT = 6;

export type ChangedFile = {
  readonly file: string;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly DiffHunk[];
};

export const splitDisplayPath = (
  file: string
): { readonly directory: string; readonly filename: string } => {
  const trimmed = file.replace(/[/\\]+$/u, "");
  const parts = trimmed.split(/[/\\]/u);
  const filename = parts[parts.length - 1] ?? "";
  if (parts.length < 2) {
    return { directory: "", filename };
  }
  return { directory: `${parts.slice(0, -1).join("/")}/`, filename };
};

// The card is the settled summary of one turn. Tool-group status flips between
// steps, so gating on "a tool is running" mounts the card in the gap and
// unmounts it when the next tool starts.
export const isActiveTurnMessage = (
  messages: readonly Pick<ChatMessage, "id" | "author">[],
  messageId: string
): boolean => {
  let start = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.author === "user") {
      start = index + 1;
      break;
    }
  }
  for (let index = start; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (candidate?.id === messageId && candidate.author === "agent") return true;
  }
  return false;
};

export const collectChangedFiles = (message: ChatMessage): ChangedFile[] => {
  const byFile = new Map<string, ChangedFile>();
  for (const block of message.blocks) {
    if (block.type !== "tools") continue;
    for (const call of block.group.calls) {
      if (call.status === "error" || call.details?.type !== "edit") continue;
      const file = call.details.file.trim();
      if (file.length === 0) continue;
      // ponytail: last write wins per path. This is the last tool's +/- / hunks,
      // not a git numstat of the whole turn. Upgrade: snapshot like OpenCode.
      byFile.set(file, {
        file,
        additions: call.details.additions,
        deletions: call.details.deletions,
        hunks: call.details.hunks
      });
    }
  }
  return [...byFile.values()];
};
