export { LyraAgentsApp, LyraAgentsShell } from "./LyraAgentsApp";
export type { LyraAgentsAppProps, LyraAgentsShellProps } from "./LyraAgentsApp";

export {
  DataContextProvider,
  useData,
  type DataProviderValue,
} from "./data/DataProvider";
export {
  createDataProviderValue,
  type CreateDataProviderValueInput,
} from "./data/createDataProviderValue";

export { APP_CONFIG, type AppConfig } from "./core/config";
export { getLocale, setLocale, t, type Locale } from "@workbench/i18n";
export type * from "./core/types";

export { ChatView, Composer, Message } from "./features/chat";
export { ToolDetails, ToolGroupBlock } from "./features/tools";
export { PlainAgentText, StreamingText } from "./features/rich-text";
export { DecisionPanel, PermissionPanel } from "./features/panels";
export { TodoBar, DiffStats, PillsRail } from "./features/pills";
export { Header } from "./features/header";
