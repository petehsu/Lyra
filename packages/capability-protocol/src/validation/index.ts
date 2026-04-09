import {
  CAPABILITY_AI_EXPOSURES,
  CAPABILITY_APPROVAL_MODES,
  CAPABILITY_DOMAINS,
  CAPABILITY_KINDS,
  CAPABILITY_RISKS,
  LYRA_APP_PLATFORMS,
  LYRA_APP_SOURCES,
  LYRA_APP_SURFACES,
  type CapabilityDescriptor,
  type CapabilityRegistrySnapshot,
  type LyraAppManifest
} from "../types";

const CAPABILITY_ID_PATTERN = /^[a-z0-9-]+\.[a-z0-9._-]+$/;
const PERMISSION_PATTERN = /^[a-z0-9-]+(?::[a-z0-9._-]+)*$/;

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && Array.isArray(value) === false;

const hasSchema = (value: unknown): boolean => isPlainObject(value) && Object.keys(value).length > 0;

const push = (issues: string[], condition: boolean, message: string): void => {
  if (!condition) {
    issues.push(message);
  }
};

export const validateCapabilityDescriptor = (descriptor: CapabilityDescriptor): readonly string[] => {
  const issues: string[] = [];
  push(issues, CAPABILITY_ID_PATTERN.test(descriptor.id), `capability ${descriptor.id} must match domain.operation format`);
  push(issues, CAPABILITY_DOMAINS.includes(descriptor.domain), `capability ${descriptor.id} has unknown domain`);
  push(issues, CAPABILITY_KINDS.includes(descriptor.kind), `capability ${descriptor.id} has unknown kind`);
  push(issues, CAPABILITY_RISKS.includes(descriptor.risk), `capability ${descriptor.id} has unknown risk`);
  push(issues, CAPABILITY_APPROVAL_MODES.includes(descriptor.approvalMode), `capability ${descriptor.id} has unknown approvalMode`);
  push(issues, CAPABILITY_AI_EXPOSURES.includes(descriptor.aiExposure), `capability ${descriptor.id} has unknown aiExposure`);
  push(issues, descriptor.title.trim().length > 0, `capability ${descriptor.id} title is required`);
  push(issues, descriptor.appId.trim().length > 0, `capability ${descriptor.id} appId is required`);
  push(issues, descriptor.operation.trim().length > 0, `capability ${descriptor.id} operation is required`);
  push(issues, descriptor.id.startsWith(`${descriptor.domain}.`), `capability ${descriptor.id} must use ${descriptor.domain}. prefix`);
  push(issues, hasSchema(descriptor.inputSchema), `capability ${descriptor.id} inputSchema is required`);
  push(issues, hasSchema(descriptor.outputSchema), `capability ${descriptor.id} outputSchema is required`);
  push(
    issues,
    descriptor.permissions.every((permission) => PERMISSION_PATTERN.test(permission)),
    `capability ${descriptor.id} has invalid permissions`
  );
  if (descriptor.eventSchema !== undefined) {
    push(issues, hasSchema(descriptor.eventSchema), `capability ${descriptor.id} eventSchema must be a non-empty object`);
  }
  return issues;
};

export const validateLyraAppManifest = (manifest: LyraAppManifest): readonly string[] => {
  const issues: string[] = [];
  push(issues, manifest.id.trim().length > 0, "app id is required");
  push(issues, manifest.title.trim().length > 0, `app ${manifest.id} title is required`);
  push(issues, manifest.version.trim().length > 0, `app ${manifest.id} version is required`);
  push(issues, LYRA_APP_SOURCES.includes(manifest.source), `app ${manifest.id} has unknown source`);
  push(
    issues,
    manifest.permissions.every((permission) => PERMISSION_PATTERN.test(permission)),
    `app ${manifest.id} has invalid permissions`
  );
  push(
    issues,
    manifest.contributes.surfaces.length > 0 && manifest.contributes.surfaces.every((surface) => LYRA_APP_SURFACES.includes(surface)),
    `app ${manifest.id} must contribute at least one known surface`
  );
  if (manifest.entry !== undefined) {
    push(issues, manifest.entry.trim().length > 0, `app ${manifest.id} entry cannot be blank`);
  }
  if (manifest.compatibility.platforms !== undefined) {
    push(
      issues,
      manifest.compatibility.platforms.every((platform) => LYRA_APP_PLATFORMS.includes(platform)),
      `app ${manifest.id} has unknown compatibility platforms`
    );
  }
  return issues;
};

export const validateCapabilityRegistrySnapshot = (
  snapshot: CapabilityRegistrySnapshot
): readonly string[] => {
  const issues: string[] = [];
  const seenCapabilityIds = new Set<string>();
  const seenAppIds = new Set<string>();

  for (const app of snapshot.apps) {
    issues.push(...validateLyraAppManifest(app));
    if (seenAppIds.has(app.id)) {
      issues.push(`duplicate app id: ${app.id}`);
    }
    seenAppIds.add(app.id);
  }

  for (const capability of snapshot.capabilities) {
    issues.push(...validateCapabilityDescriptor(capability));
    if (seenCapabilityIds.has(capability.id)) {
      issues.push(`duplicate capability id: ${capability.id}`);
    }
    seenCapabilityIds.add(capability.id);
    if (seenAppIds.has(capability.appId) === false) {
      issues.push(`capability ${capability.id} references unknown app ${capability.appId}`);
    }
  }

  for (const app of snapshot.apps) {
    for (const capabilityId of app.capabilities) {
      if (seenCapabilityIds.has(capabilityId) === false) {
        issues.push(`app ${app.id} references unknown capability ${capabilityId}`);
      }
    }
  }

  return issues;
};
