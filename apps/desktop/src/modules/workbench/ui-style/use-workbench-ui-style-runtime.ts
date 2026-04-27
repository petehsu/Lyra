import { useEffect, useMemo } from "react";

import {
  resolveWorkbenchUiStylePack,
  syncWorkbenchUiStyleToDocument
} from "./service";
import type { WorkbenchUiStyleId, WorkbenchUiStylePack } from "./types";

export type WorkbenchUiStyleRuntime = {
  readonly stylePack: WorkbenchUiStylePack;
  readonly rootClassName: string;
  readonly rootAttributes: WorkbenchUiStylePack["rootAttributes"];
  readonly vars: WorkbenchUiStylePack["vars"];
};

export const useWorkbenchUiStyleRuntime = (
  styleId: WorkbenchUiStyleId
): WorkbenchUiStyleRuntime => {
  const stylePack = useMemo(
    () => resolveWorkbenchUiStylePack(styleId),
    [styleId]
  );

  useEffect(() => {
    syncWorkbenchUiStyleToDocument(stylePack);
  }, [stylePack]);

  return useMemo(
    () => ({
      stylePack,
      rootClassName: stylePack.rootClassName,
      rootAttributes: stylePack.rootAttributes,
      vars: stylePack.vars
    }),
    [stylePack]
  );
};
