// ============================================================================
// pre-measure — optional plain-text height seeding for chat virtualization
// ============================================================================
//
// Uses the workbench text-metrics layer (canvas measurement, no DOM reflow)
// to estimate the height of PLAIN-TEXT messages that have not been rendered yet,
// so their spacer placeholder is roughly correct and the first paint does not
// jump. This is only a seed: the real height always wins once the slot mounts
// and the ResizeObserver measures it (see use-message-height-table.ts).
//
// Deliberately conservative: anything that is not a single plain-text block
// (markdown structure, images, mermaid, tool cards) returns null so the caller
// uses a neutral constant fallback instead of a wrong estimate. Wrapped so a
// measurement failure can never break rendering.

import type { ChatMessage } from "../../core/types";
import {
  estimateParagraphHeight,
  type EstimateParagraphConfig
} from "../../../../text-metrics";

/** Extract a plain-text body only when the message is purely text blocks. */
const plainTextBodyOf = (message: ChatMessage): string | null => {
  if (message.blocks.length === 0) return null;
  const parts: string[] = [];
  for (const block of message.blocks) {
    if (block.type !== "text") return null;
    parts.push(block.body);
  }
  const text = parts.join("\n\n").trim();
  if (text.length === 0) return null;
  // Markdown structure makes the rendered height diverge from a plain paragraph;
  // skip estimation for those and let the neutral fallback + measure-on-render
  // handle it.
  if (/[#`*_>|]|\]\(|^\s*[-+]\s|\d+\.\s/m.test(text)) return null;
  return text;
};

export type PreMeasureConfig = EstimateParagraphConfig;

/**
 * Estimate a plain-text message's rendered height, or null when the message is
 * not safely estimable. Never throws.
 */
export const estimatePlainTextHeight = (
  message: ChatMessage,
  config: PreMeasureConfig
): number | null => {
  const body = plainTextBodyOf(message);
  if (body === null) return null;
  return estimateParagraphHeight(body, config);
};