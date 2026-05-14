import type {
  ChatMessage,
  DecisionQuestion,
  DiffFileEntry,
  PermissionRequest,
  SessionMeta,
  TodoItem,
} from "../core/types";
import type { DataProviderValue } from "./DataProvider";

export interface CreateDataProviderValueInput {
  session: SessionMeta;
  messages: ChatMessage[];
  todos?: TodoItem[];
  diffFiles?: DiffFileEntry[];
  decisions?: DecisionQuestion[];
  permissions?: PermissionRequest[];
  sendMessage?: (text: string) => Promise<void>;
  submitDecisions?: (answers: Record<string, string>) => Promise<void>;
  approvePermission?: (id: string) => Promise<void>;
  denyPermission?: (id: string) => Promise<void>;
  isMock?: boolean;
}

const resolved = Promise.resolve();

export function createDataProviderValue({
  session,
  messages,
  todos = [],
  diffFiles = [],
  decisions = [],
  permissions = [],
  sendMessage = () => resolved,
  submitDecisions = () => resolved,
  approvePermission = () => resolved,
  denyPermission = () => resolved,
  isMock = false,
}: CreateDataProviderValueInput): DataProviderValue {
  return {
    session,
    messages,
    todos,
    diffFiles,
    decisions,
    permissions,
    sendMessage,
    submitDecisions,
    approvePermission,
    denyPermission,
    isMock,
  };
}
