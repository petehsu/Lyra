export const withBrowserUsePrivacyEnv = (
  env: NodeJS.ProcessEnv,
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv => ({
  ...env,
  DO_NOT_TRACK: "1",
  DISABLE_TELEMETRY: "1",
  ANONYMIZED_TELEMETRY: "false",
  BROWSER_USE_TELEMETRY_DISABLED: "1",
  POSTHOG_DISABLED: "true",
  SCARF_NO_ANALYTICS: "true",
  ...extra
});
