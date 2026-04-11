import { parseElementPickerConsoleMessage } from "./console-channel";
import { createWorkbenchManualElementPickerSession } from "./manual-session";
import type {
  WorkbenchElementPickerSessionDeps,
  WorkbenchManualElementPickerSession
} from "./types";

export const createWorkbenchElementPickerSession = (
  deps: WorkbenchElementPickerSessionDeps
): WorkbenchManualElementPickerSession => createWorkbenchManualElementPickerSession(deps);

export const routeElementPickerConsoleMessage = (
  session: WorkbenchManualElementPickerSession,
  rawMessage: string
): { readonly matched: boolean; readonly disableRequested: boolean } => {
  const parsed = parseElementPickerConsoleMessage(rawMessage);
  if (parsed === null) {
    return {
      matched: false,
      disableRequested: false
    };
  }
  const result = session.handleConsoleMessage(parsed);
  return {
    matched: true,
    disableRequested: result.disableRequested
  };
};
