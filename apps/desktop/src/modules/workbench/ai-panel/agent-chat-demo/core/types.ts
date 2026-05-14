// ============================================================================
// Lyra Agent UI — Core Domain Types
// ============================================================================
//
// This file is the single source of truth for all domain models the UI
// consumes. It is framework-agnostic and contains no React types so it can
// be reused from a server-side rendering pipeline or type-checked from
// external data providers.

export type ToolStatus = "running" | "success" | "error";

export type ToolKind =
  | "read"
  | "edit"
  | "search"
  | "shell"
  | "web"
  | "thought"
  | "task"
  | "create";

export interface ToolCall {
  id: string;
  kind: ToolKind;
  title: string;
  status: ToolStatus;
  details?: ToolDetails;
}

export type ToolDetails =
  | { type: "edit"; file: string; additions: number; deletions: number; hunks: DiffHunk[] }
  | { type: "read"; file: string; range?: string; preview?: string }
  | { type: "search"; query: string; results: SearchResult[] }
  | { type: "shell"; command: string; output: string; exitCode: number }
  | { type: "web"; url: string; summary?: string }
  | { type: "task"; tasks: TodoTask[] }
  | { type: "text"; body: string }
  | { type: "ask"; question: string; answer: string };

export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

export interface DiffHunk {
  startLine: number;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

export interface TodoTask {
  title: string;
  status: "pending" | "running" | "done";
}

export type GroupStatus = "running" | "done";

export interface ToolGroup {
  id: string;
  status: GroupStatus;
  label: string;
  hint?: string;
  calls: ToolCall[];
  currentCallId?: string;
}

export type MessageBlock =
  | { type: "text"; id: string; body: string }
  | { type: "tools"; id: string; group: ToolGroup };

export interface ChatMessage {
  id: string;
  author: "user" | "agent";
  blocks: MessageBlock[];
  time?: string;
}

// Session-level state surfaced through the data provider ------------------

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "running" | "done";
}

export interface DiffFileEntry {
  file: string;
  additions: number;
  deletions: number;
}

export interface DecisionQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface PermissionRequest {
  id: string;
  type: "shell" | "file" | "network" | "dangerous";
  title: string;
  detail: string;
}

export interface SessionMeta {
  title: string;
  project: string;
  totalAdditions: number;
  totalDeletions: number;
}
