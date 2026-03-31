import type { SidebarComposerMode } from "../sidebar/types";
import type { SidebarComposerToken } from "../sidebar/types";

export type AiPanelMessageRole = "user" | "assistant";

export type AiPanelMessage = {
  readonly id: string;
  readonly role: AiPanelMessageRole;
  readonly mode: SidebarComposerMode;
  readonly content: string;
  readonly tokens?: readonly SidebarComposerToken[];
  readonly createdAt: number;
  readonly isPending: boolean;
};

export type AiPanelMessageUserActionId =
  | "copy"
  | "fork"
  | "undo"
  | "edit"
  | "quote";

export type AiPanelMessageAssistantActionId =
  | "copy"
  | "quote";
