import { useMemo, type ReactNode } from "react";

import type { WorkbenchChromeSlots } from "./workbench-chrome";

type UseWorkbenchShellSlotsParams = {
  readonly titlebarNavigation: ReactNode;
  readonly leftPanel: ReactNode;
  readonly workspace: ReactNode;
  readonly browserTabs: ReactNode;
  readonly terminalPanel: ReactNode;
  readonly overlays: ReactNode;
};

export const useWorkbenchShellSlots = ({
  titlebarNavigation,
  leftPanel,
  workspace,
  browserTabs,
  terminalPanel,
  overlays
}: UseWorkbenchShellSlotsParams): WorkbenchChromeSlots =>
  useMemo(
    () => ({
      titlebarNavigation,
      leftPanel,
      workspace,
      browserTabs,
      terminalPanel,
      overlays
    }),
    [
      browserTabs,
      leftPanel,
      overlays,
      terminalPanel,
      titlebarNavigation,
      workspace
    ]
  );
