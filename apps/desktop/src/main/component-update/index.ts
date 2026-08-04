export {
  createComponentUpdateService,
  resolveBootstrapExecutable,
  resolveComponentTarget,
  resolveVerifiedReleaseCatalogPath,
  type ComponentOnDemandStageRequest,
  type ComponentUpdateService
} from "./service";
export {
  CORE_COMPONENT_ID,
  createCoreProjectionCoordinator,
  resolveDesktopProgramRoot,
  type CoreProjectionCoordinator,
  type CoreProjectionCoordinatorOptions,
  type CoreProjectionHandoff,
  type CoreProjectionStatus
} from "./core-projection";
export {
  parseComponentUpdateChannels,
  readComponentUpdateChannels,
  resolveComponentUpdateChannelConfigPath,
  type ComponentUpdateChannelConfigPathOptions,
  type ComponentUpdateChannelResolutionOptions
} from "./channels";
