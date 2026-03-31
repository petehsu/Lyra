import type { AiPanelMessage } from "./chat-types";
import type { AiPanelRuntimeItem, AiPanelRuntimePresentation } from "./runtime";

export type AiPanelThreadTimelineEntry =
  | {
      readonly kind: "message";
      readonly createdAt: number;
      readonly index: number;
      readonly message: AiPanelMessage;
    }
  | {
      readonly kind: "runtime";
      readonly createdAt: number;
      readonly index: number;
      readonly item: AiPanelRuntimeItem;
      readonly presentation: AiPanelRuntimePresentation;
    };

const compareTimelineEntry = (
  left: AiPanelThreadTimelineEntry,
  right: AiPanelThreadTimelineEntry
): number => {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  return left.index - right.index;
};

export const buildAiPanelThreadTimeline = (
  messages: readonly AiPanelMessage[],
  runtimeItems: readonly AiPanelRuntimeItem[],
  runtimeVariant: "sidebar" | "workspace"
): readonly AiPanelThreadTimelineEntry[] => {
  const messageEntries = messages.map((message, index) => ({
    kind: "message" as const,
    createdAt: message.createdAt,
    index,
    message
  }));
  const runtimeEntries = runtimeItems.reduce<AiPanelThreadTimelineEntry[]>((entries, item, index) => {
    const nextIndex = messages.length + index;
    entries.push({
      kind: "runtime",
      createdAt: item.createdAt,
      index: nextIndex,
      item,
      presentation: runtimeVariant === "workspace" ? "capsule" : item.presentation
    });
    return entries;
  }, []);
  return [...messageEntries, ...runtimeEntries].sort(compareTimelineEntry);
};
