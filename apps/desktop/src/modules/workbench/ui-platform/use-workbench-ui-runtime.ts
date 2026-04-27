import { useEffect, useMemo } from "react";

import {
  resolveWorkbenchUiPack,
  syncWorkbenchUiPackToDocument
} from "./service";
import type { WorkbenchUiPackId } from "./ids";
import type { WorkbenchUiRuntime } from "./types";

export const useWorkbenchUiRuntime = (
  packId: WorkbenchUiPackId
): WorkbenchUiRuntime => {
  const pack = useMemo(
    () => resolveWorkbenchUiPack(packId),
    [packId]
  );

  useEffect(() => {
    syncWorkbenchUiPackToDocument(pack);
  }, [pack]);

  return useMemo(
    () => ({
      pack,
      packId: pack.manifest.id,
      stylePack: pack.style,
      rootClassName: pack.style.rootClassName,
      rootAttributes: {
        ...pack.style.rootAttributes,
        "data-lyra-ui-pack": pack.manifest.id
      },
      vars: pack.style.vars,
      adapters: pack.adapters,
      interactions: pack.interactions
    }),
    [pack]
  );
};
