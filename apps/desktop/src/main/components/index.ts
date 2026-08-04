export {
  COMPONENT_REGISTRY_SCHEMA_VERSION,
  createComponentRegistryStore,
  type ComponentRegistryStore,
  type ComponentRegistryStoreOptions,
  type ComponentReleaseKeyScope,
  type ComponentRegistryV1,
  type InstalledComponentV1,
  type InstalledComponentVersionV1
} from "./registry";
export {
  createCanonicalActivationRegistryClient,
  parseBootstrapActivationRegistry,
  type BootstrapActivationRegistryV1,
  type BootstrapActivationStateV1,
  type CanonicalActivationRegistryClient
} from "./bootstrap-registry-client";
export { createComponentsIpcBridge } from "./service";
export { LYRA_APP_MODULE_SCHEME } from "./app-module-assets";
export {
  readTrustedComponentRoots,
  readVerifiedReleaseKeys,
  type TrustedComponentRoots,
  type VerifiedReleaseKeys
} from "./trust";
export {
  MODULE_DATA_METADATA_FILE,
  createModuleDataSchemaStore,
  type ModuleDataActivationState,
  type ModuleDataMetadataV1,
  type ModuleDataRecoveryRecord,
  type ModuleDataSchemaTransaction,
  type ModuleDataSchemaStore
} from "./data-schema";
export {
  ARIA2_RESOURCE_COMPONENT_ID,
  LANGUAGE_RESOURCE_COMPONENT_PREFIX,
  PLAYWRIGHT_RESOURCE_COMPONENT_ID,
  RUST_ANALYZER_RESOURCE_COMPONENT_ID,
  ResourceComponentBusyError,
  ResourceComponentUpdatePendingError,
  createResourceComponentManager,
  readActiveLanguageResourceBundles,
  readLanguageResourceBundle,
  type LanguageResourceBundle,
  type ResolvedResourceComponent,
  type ResourceComponentLease,
  type ResourceComponentManager
} from "./resource-components";
export {
  applyRuntimeResourceComponentEnvironment,
  type RuntimeResourceEnvironmentResult,
  type RuntimeResourceEnvironmentStatus
} from "./resource-environment";
export {
  ResourceConsumerBindingError,
  ResourceConsumerUnavailableError,
  createBoundResourceConsumerLease,
  type ResourceConsumerLeaseRunner
} from "./resource-consumer-leases";
export {
  createResourceComponentUpdateService,
  recoverUnhealthyActiveResourceComponents,
  type ResourceComponentRecoveryResult,
  type ResourceComponentUpdateService
} from "./resource-update";
export {
  createPlaywrightResourceAcquisitionService,
  type PlaywrightResourceAcquisitionService,
  type PlaywrightResourceAvailability
} from "./playwright-acquisition";
