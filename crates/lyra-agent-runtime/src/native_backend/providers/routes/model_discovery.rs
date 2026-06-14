use crate::{
    AgentRuntimeResult,
    native_backend::{NativeProviderModel, NativeProviderProfile},
};

use super::super::types::ProviderRouteDescriptor;

#[allow(dead_code)]
pub(crate) trait RouteModelDiscoveryHook: Sync {
    fn descriptor(&self) -> ProviderRouteDescriptor;

    fn discover_models(
        &self,
        provider: &NativeProviderProfile,
    ) -> AgentRuntimeResult<Vec<NativeProviderModel>>;
}
