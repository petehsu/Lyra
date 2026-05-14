/* eslint-disable react-refresh/only-export-components */
// ============================================================================
// Lyra Agent UI — Data Provider
// ============================================================================
//
// The entire app consumes data through a single React Context so switching
// between mock data and a real backend is a one-line change in App.tsx:
//
//   <MockDataProvider>...</MockDataProvider>   →   <ApiDataProvider>...</ApiDataProvider>
//
// Implementors of a real provider only need to match the DataProviderValue
// shape. See `MockDataProvider.tsx` for the reference implementation.

import { createContext, useContext, type ReactNode } from "react";
import type {
  ChatMessage,
  DecisionQuestion,
  DiffFileEntry,
  PermissionRequest,
  SessionMeta,
  TodoItem,
} from "../core/types";

export interface DataProviderValue {
  /** Session-level metadata (title, project, total diff). */
  session: SessionMeta;

  /** Chat messages in chronological order. */
  messages: ChatMessage[];

  /** Global todo list aggregated from all task tool calls in the session. */
  todos: TodoItem[];

  /** Files modified in the current work session. */
  diffFiles: DiffFileEntry[];

  /** Pending decision questions from the agent. */
  decisions: DecisionQuestion[];

  /** Pending permission requests from the agent. */
  permissions: PermissionRequest[];

  /** Send a new user message. Returns a promise that resolves when delivered. */
  sendMessage(text: string): Promise<void>;

  /** Answer one or more decision questions. */
  submitDecisions(answers: Record<string, string>): Promise<void>;

  /** Approve a permission request by id. */
  approvePermission(id: string): Promise<void>;

  /** Deny a permission request by id. */
  denyPermission(id: string): Promise<void>;

  /** True if this provider is backed by mock data. */
  readonly isMock: boolean;
}

const DataContext = createContext<DataProviderValue | null>(null);

export function useData(): DataProviderValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error(
      "useData() must be used inside a <MockDataProvider> or <ApiDataProvider>."
    );
  }
  return ctx;
}

export function DataContextProvider({
  value,
  children,
}: {
  value: DataProviderValue;
  children: ReactNode;
}) {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
