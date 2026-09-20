export type FirstPartyAppReleaseContractV1 = readonly [
  componentId: string,
  packageDirectory: string,
  permissions: readonly string[]
];

/**
 * Permission input for signed first-party app manifests, plus the complete
 * subset that may take app-only packaging. Keep this side-effect free so
 * release tooling and contract tests share one source of truth. Preview
 * bundles stay in full installer releases because Core still owns those
 * routes; a signed archive only replaces the user-facing page for complete
 * IDs (plus Classic UIUX).
 */
export const COMPLETE_FIRST_PARTY_APP_IDS_V1 = [
  "lyra.credentials",
  "lyra.downloads",
  "lyra.notifications"
] as const;

export const isCompleteFirstPartyAppId = (
  componentId: string
): componentId is (typeof COMPLETE_FIRST_PARTY_APP_IDS_V1)[number] =>
  (COMPLETE_FIRST_PARTY_APP_IDS_V1 as readonly string[]).includes(componentId);

export const FIRST_PARTY_APP_RELEASE_CONTRACTS_V1 = [
  ["lyra.browser", "lyra-browser", [
    "browser:read", "browser:navigate", "files:read", "downloads:write"
  ]],
  ["lyra.files", "lyra-files", ["files:read", "files:write", "apps:open"]],
  ["lyra.editor", "lyra-editor", ["files:read", "files:write"]],
  ["lyra.images", "lyra-images", ["files:read"]],
  ["lyra.terminal", "lyra-terminal", ["terminal:read", "terminal:write"]],
  ["lyra.downloads", "lyra-downloads", ["downloads:read", "downloads:write"]],
  ["lyra.agent", "lyra-agent", [
    "agent:read", "agent:write", "agent:git",
    "apps:open", "browser:navigate", "files:read", "files:write", "terminal:read",
    "terminal:write", "notifications:publish", "settings:open"
  ]],
  ["lyra.credentials", "lyra-credentials", [
    "credentials:read", "credentials:write", "browser:navigate", "settings:open"
  ]],
  ["lyra.notifications", "lyra-notifications", ["notifications:read"]]
] as const satisfies readonly FirstPartyAppReleaseContractV1[];
