import type { ComponentActivationAssessment, ComponentActivationRisk } from "../../shared/desktop-bridge";
import type { InstalledComponentV1 } from "./registry";

const majorVersion = (version: string | undefined): number | undefined => {
  if (version === undefined) {
    return undefined;
  }
  const value = Number.parseInt(version.split(".", 1)[0] ?? "", 10);
  return Number.isSafeInteger(value) ? value : undefined;
};

export const assessComponentActivation = (
  component: InstalledComponentV1
): ComponentActivationAssessment => {
  const pendingVersion = component.pending;
  if (pendingVersion === undefined) {
    throw new Error(`Component has no pending version: ${component.componentId}`);
  }
  const pending = component.versions[pendingVersion];
  if (pending === undefined) {
    throw new Error(
      `Pending component version is missing: ${component.componentId}@${pendingVersion}`
    );
  }
  const active = component.active === undefined ? undefined : component.versions[component.active];
  const reasons = new Set<ComponentActivationRisk>();
  const activePermissions = new Set(active?.manifest.permissions ?? []);
  const addedPermissions = pending.manifest.permissions.filter(
    (permission) => !activePermissions.has(permission)
  );
  if (addedPermissions.length > 0) {
    reasons.add("permission-increase");
  }
  if (active !== undefined) {
    if (active.manifest.publisher !== pending.manifest.publisher) {
      reasons.add("publisher-change");
    }
    if (active.manifest.executionClass !== pending.manifest.executionClass) {
      reasons.add("execution-class-change");
    }
    if (majorVersion(active.manifest.version) !== majorVersion(pending.manifest.version)) {
      reasons.add("component-major-change");
    }
    if (
      majorVersion(active.manifest.hostApiRange?.minInclusive)
      !== majorVersion(pending.manifest.hostApiRange?.minInclusive)
    ) {
      reasons.add("host-api-major-change");
    }
    if (active.manifest.dataSchema.writer !== pending.manifest.dataSchema.writer) {
      reasons.add("data-migration");
    }
  }
  return {
    componentId: component.componentId,
    ...(component.active === undefined ? {} : { activeVersion: component.active }),
    pendingVersion,
    reasons: [...reasons],
    addedPermissions,
    requiresConfirmation: reasons.size > 0
  };
};
