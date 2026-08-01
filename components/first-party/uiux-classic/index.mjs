export const manifest = Object.freeze({
  id: "classic",
  label: "Classic",
  description: "Lyra's standard desktop layout and visual language.",
  version: "1.0.0",
  compatibility: { workbenchUiApi: "1" },
  source: { type: "builtin" },
  capabilities: {
    supportsStyleTokens: true,
    supportsShellAdapter: true,
    supportsWorkspaceTabsAdapter: true,
    supportsPanelAdapters: true,
    supportsWorkspaceSurfaceAdapter: true,
    supportsWorkbenchSurfaceAdapters: true,
    supportsInteractionPolicy: true,
    supportsTrustedJsDistribution: false,
    supportsCommunityDistribution: false
  }
});

export const createPack = (context) => ({
  manifest,
  style: {
    ...context.style,
    id: "classic",
    rootClassName: "lyra-style-classic",
    documentClassName: "lyra-style-classic",
    rootAttributes: { "data-lyra-ui-style": "classic" },
    vars: {}
  },
  adapters: context.adapters,
  interactions: context.interactions
});
