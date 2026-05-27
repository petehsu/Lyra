import { useEffect, useMemo, useState } from "react";

import {
  isBuiltinWorkbenchUiPackId,
  loadExternalWorkbenchUiPack,
  resolveWorkbenchUiPack,
  syncExternalWorkbenchUiPackCss,
  syncWorkbenchUiPackToDocument
} from "./service";
import type { WorkbenchUiPackId } from "./ids";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  LyraSoftwareCapabilitiesContext,
  LyraSoftwareManifest
} from "../../../shared/software-capabilities";
import type { WorkbenchUiPack, WorkbenchUiRuntime } from "./types";

export const useWorkbenchUiRuntime = (
  packId: WorkbenchUiPackId,
  desktopApi: LyraDesktopApi | null = null,
  createCapabilities?: (
    packId: string,
    software: readonly LyraSoftwareManifest[]
  ) => LyraSoftwareCapabilitiesContext
): WorkbenchUiRuntime => {
  const builtinPack = useMemo(
    () => resolveWorkbenchUiPack(packId),
    [packId]
  );
  const [externalPack, setExternalPack] = useState<WorkbenchUiPack | null>(null);

  useEffect(() => {
    if (isBuiltinWorkbenchUiPackId(packId)) {
      setExternalPack(null);
      syncExternalWorkbenchUiPackCss(null);
      return;
    }

    let cancelled = false;
    setExternalPack(null);

    if (desktopApi?.uiux === undefined) {
      syncExternalWorkbenchUiPackCss(null);
      console.warn(`[lyra-uiux] desktop UIUX bridge unavailable; falling back to classic for ${packId}`);
      return;
    }

    void desktopApi.uiux.resolveRuntime({ packId })
      .then(async (runtime) => {
        if (runtime === null) {
          throw new Error("pack is not installed, trusted, or compatible");
        }
        const loadedPack = await loadExternalWorkbenchUiPack({
          packId,
          runtime,
          desktopApi,
          ...(createCapabilities === undefined
            ? {}
            : { capabilities: createCapabilities(packId, runtime.software) })
        });
        if (cancelled) {
          return;
        }
        syncExternalWorkbenchUiPackCss(runtime.cssUrl ?? null);
        setExternalPack(loadedPack);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        syncExternalWorkbenchUiPackCss(null);
        console.warn(`[lyra-uiux] failed to load ${packId}; falling back to classic`, error);
        setExternalPack(null);
      });

    return () => {
      cancelled = true;
    };
  }, [createCapabilities, desktopApi, packId]);

  const pack = isBuiltinWorkbenchUiPackId(packId)
    ? builtinPack
    : externalPack ?? resolveWorkbenchUiPack();

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
