export type AgentProjectTreeEditorTab = {
  readonly editorInstanceId: string;
  readonly filePath: string;
  readonly preview: boolean;
};

export type OpenEditorTabResult = {
  readonly tabs: readonly AgentProjectTreeEditorTab[];
  readonly activeEditorInstanceId: string;
};

const samePath = (left: string, right: string): boolean =>
  left.replaceAll("\\", "/") === right.replaceAll("\\", "/");

export const applyOpenEditorTab = (
  tabs: readonly AgentProjectTreeEditorTab[],
  filePath: string,
  options: {
    readonly pinned: boolean;
    readonly createInstanceId: (filePath: string) => string;
  }
): OpenEditorTabResult => {
  const existing = tabs.find((tab) => samePath(tab.filePath, filePath));
  if (existing !== undefined) {
    if (options.pinned === false || existing.preview === false) {
      return {
        tabs,
        activeEditorInstanceId: existing.editorInstanceId
      };
    }
    return {
      tabs: tabs.map((tab) =>
        tab.editorInstanceId === existing.editorInstanceId
          ? { ...tab, preview: false }
          : tab
      ),
      activeEditorInstanceId: existing.editorInstanceId
    };
  }

  const preview = options.pinned ? undefined : tabs.find((tab) => tab.preview);
  if (preview !== undefined) {
    return {
      tabs: tabs.map((tab) =>
        tab.editorInstanceId === preview.editorInstanceId
          ? { ...tab, filePath, preview: true }
          : tab
      ),
      activeEditorInstanceId: preview.editorInstanceId
    };
  }

  const editorInstanceId = options.createInstanceId(filePath);
  return {
    tabs: [
      ...tabs,
      {
        editorInstanceId,
        filePath,
        preview: options.pinned === false
      }
    ],
    activeEditorInstanceId: editorInstanceId
  };
};

export const applyPinEditorTab = (
  tabs: readonly AgentProjectTreeEditorTab[],
  editorInstanceId: string
): readonly AgentProjectTreeEditorTab[] =>
  tabs.map((tab) =>
    tab.editorInstanceId === editorInstanceId ? { ...tab, preview: false } : tab
  );

export const applyCloseEditorTab = (
  tabs: readonly AgentProjectTreeEditorTab[],
  editorInstanceId: string,
  activeEditorInstanceId: string | null
): {
  readonly tabs: readonly AgentProjectTreeEditorTab[];
  readonly activeEditorInstanceId: string | null;
} => {
  const index = tabs.findIndex((tab) => tab.editorInstanceId === editorInstanceId);
  if (index < 0) {
    return { tabs, activeEditorInstanceId };
  }
  const nextTabs = tabs.filter((tab) => tab.editorInstanceId !== editorInstanceId);
  if (activeEditorInstanceId !== editorInstanceId) {
    return { tabs: nextTabs, activeEditorInstanceId };
  }
  const neighbor = nextTabs[index] ?? nextTabs[index - 1];
  return {
    tabs: nextTabs,
    activeEditorInstanceId: neighbor?.editorInstanceId ?? null
  };
};
