import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ComponentUpdateChannel } from "../../shared/desktop-bridge";

const CHANNEL_CONFIG_SCHEMA_VERSION = 1 as const;
const TARGET_PLACEHOLDER = "{target}";
const MAX_CHANNEL_CONFIG_BYTES = 64 * 1024;
const CHANNELS = ["stable", "preview"] as const satisfies readonly ComponentUpdateChannel[];
const TARGET_PATTERN = /^(?:darwin|windows|linux)-(?:x64|arm64)$/u;

type ComponentUpdateChannelConfigV1 = {
  readonly schemaVersion: typeof CHANNEL_CONFIG_SCHEMA_VERSION;
  readonly channels: Readonly<Partial<Record<ComponentUpdateChannel, string>>>;
};

export type ComponentUpdateChannelResolutionOptions = {
  readonly filePath: string;
  readonly target: string;
  readonly isPackaged: boolean;
  readonly env?: NodeJS.ProcessEnv;
};

export type ComponentUpdateChannelConfigPathOptions = {
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly cwd?: string;
};

const CHANNEL_CONFIG_RELATIVE_PATH = join(
  "resources",
  "component-update",
  "channels.v1.json"
);

/**
 * Production accepts only the copy embedded in Core. Development supports the
 * two actual launch roots used by this monorepo: apps/desktop and the repo root.
 */
export const resolveComponentUpdateChannelConfigPath = ({
  resourcesPath,
  isPackaged,
  cwd = process.cwd()
}: ComponentUpdateChannelConfigPathOptions): string => {
  if (isPackaged) {
    return join(resourcesPath, "component-update", "channels.v1.json");
  }
  const candidates = [
    join(cwd, CHANNEL_CONFIG_RELATIVE_PATH),
    join(cwd, "apps", "desktop", CHANNEL_CONFIG_RELATIVE_PATH)
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveTemplate = (template: string, target: string): string => {
  if (
    template.length === 0
    || template.split(TARGET_PLACEHOLDER).length !== 2
  ) {
    throw new Error("Component update channel URL must contain exactly one {target} placeholder.");
  }
  const resolved = template.replace(TARGET_PLACEHOLDER, target);
  const url = new URL(resolved);
  if (
    url.protocol !== "https:"
    || url.username.length > 0
    || url.password.length > 0
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new Error("Component update channel URL must be credential-free HTTPS without query or fragment.");
  }
  return url.toString();
};

export const parseComponentUpdateChannels = (
  value: unknown,
  target: string
): Readonly<Partial<Record<ComponentUpdateChannel, string>>> => {
  if (!TARGET_PATTERN.test(target)) {
    throw new Error(`Component update target is invalid: ${target}`);
  }
  if (
    !isRecord(value)
    || value.schemaVersion !== CHANNEL_CONFIG_SCHEMA_VERSION
    || !isRecord(value.channels)
    || Object.keys(value).some((key) => !["schemaVersion", "channels"].includes(key))
    || Object.keys(value.channels).some(
      (key) => !CHANNELS.includes(key as ComponentUpdateChannel)
    )
  ) {
    throw new Error("Component update channel configuration is invalid.");
  }
  const result: Partial<Record<ComponentUpdateChannel, string>> = {};
  for (const channel of CHANNELS) {
    const template = value.channels[channel];
    if (template === undefined) {
      continue;
    }
    if (typeof template !== "string") {
      throw new Error(`Component update channel ${channel} must be a URL template.`);
    }
    result[channel] = resolveTemplate(template, target);
  }
  return result;
};

const readPackagedConfig = async (
  filePath: string,
  target: string
): Promise<Readonly<Partial<Record<ComponentUpdateChannel, string>>>> => {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size <= 0
    || metadata.size > MAX_CHANNEL_CONFIG_BYTES
  ) {
    throw new Error("Component update channel configuration is not a bounded regular file.");
  }
  return parseComponentUpdateChannels(
    JSON.parse(await readFile(filePath, "utf8")) as unknown,
    target
  );
};

/**
 * Packaged builds trust only the channel locations shipped inside Core.
 * Development may override an individual channel for local end-to-end tests;
 * the downloaded Catalog is still authenticated by the offline trust root.
 */
export const readComponentUpdateChannels = async ({
  filePath,
  target,
  isPackaged,
  env = process.env
}: ComponentUpdateChannelResolutionOptions): Promise<
  Readonly<Partial<Record<ComponentUpdateChannel, string>>>
> => {
  const packaged = await readPackagedConfig(filePath, target);
  if (isPackaged) {
    return packaged;
  }
  const result: Partial<Record<ComponentUpdateChannel, string>> = { ...packaged };
  for (const channel of CHANNELS) {
    const key = channel === "stable"
      ? "LYRA_COMPONENT_STABLE_CATALOG_URL"
      : "LYRA_COMPONENT_PREVIEW_CATALOG_URL";
    const override = env[key];
    if (override === undefined || override.trim().length === 0) {
      continue;
    }
    const url = new URL(override);
    if (
      url.protocol !== "https:"
      || url.username.length > 0
      || url.password.length > 0
      || url.search.length > 0
      || url.hash.length > 0
    ) {
      throw new Error(`Development component update channel ${channel} is invalid.`);
    }
    result[channel] = url.toString();
  }
  return result;
};

export const componentUpdateChannelInternalsForTests = {
  CHANNEL_CONFIG_RELATIVE_PATH,
  CHANNEL_CONFIG_SCHEMA_VERSION,
  MAX_CHANNEL_CONFIG_BYTES,
  TARGET_PLACEHOLDER
};
