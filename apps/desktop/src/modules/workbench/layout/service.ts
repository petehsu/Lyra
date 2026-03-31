import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { WorkbenchLayoutPreset, WorkbenchPanelKey } from "../shell/types";
import {
  readWorkbenchStateSync,
  removeWorkbenchStateSync,
  writeWorkbenchStateSync
} from "../state-storage";
import type { LayoutStore } from "./types";

const defaultLayoutState = {
  preset: "ide" as WorkbenchLayoutPreset,
  showFiles: true,
  showAi: true,
  showRuntime: true
};
const STORAGE_NAME = "lyra:layout:v1";
const WORKBENCH_STATE_KEY = "layout" as const;

const layoutStorage: Storage = {
  getItem: (name: string): string | null => {
    if (name !== STORAGE_NAME) {
      return null;
    }
    return readWorkbenchStateSync(WORKBENCH_STATE_KEY);
  },
  setItem: (name: string, value: string): void => {
    if (name !== STORAGE_NAME) {
      return;
    }
    writeWorkbenchStateSync(WORKBENCH_STATE_KEY, value);
  },
  removeItem: (name: string): void => {
    if (name !== STORAGE_NAME) {
      return;
    }
    removeWorkbenchStateSync(WORKBENCH_STATE_KEY);
  },
  clear: (): void => {
    removeWorkbenchStateSync(WORKBENCH_STATE_KEY);
  },
  key: (index: number): string | null => {
    if (index !== 0) {
      return null;
    }
    return readWorkbenchStateSync(WORKBENCH_STATE_KEY) === null
      ? null
      : STORAGE_NAME;
  },
  get length(): number {
    return readWorkbenchStateSync(WORKBENCH_STATE_KEY) === null ? 0 : 1;
  }
};

const applyPreset = (preset: WorkbenchLayoutPreset): Pick<LayoutStore, "showFiles" | "showAi" | "showRuntime"> => {
  if (preset === "browser") {
    return {
      showFiles: true,
      showAi: true,
      showRuntime: false
    };
  }

  return {
    showFiles: true,
    showAi: true,
    showRuntime: true
  };
};

const panelToField = (panel: WorkbenchPanelKey): keyof Pick<LayoutStore, "showFiles" | "showAi" | "showRuntime"> => {
  if (panel === "files") return "showFiles";
  if (panel === "ai") return "showAi";
  return "showRuntime";
};

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set, get) => ({
      ...defaultLayoutState,
      setPreset: (preset) => {
        set({ preset });
      },
      applyPresetDefaults: (preset) => {
        set({
          preset,
          ...applyPreset(preset)
        });
      },
      togglePanel: (panel) => {
        const field = panelToField(panel);
        const current = get()[field];
        set({ [field]: !current } as Pick<LayoutStore, typeof field>);
      },
      setPanelVisibility: (panel, visible) => {
        const field = panelToField(panel);
        set({ [field]: visible } as Pick<LayoutStore, typeof field>);
      }
    }),
    {
      name: STORAGE_NAME,
      storage: createJSONStorage(() => layoutStorage)
    }
  )
);
