use std::fmt;
use std::sync::Arc;

use lyra_api::Provider;
use lyra_api::SharedAuthProvider;
use lyra_login::AuthManager;
use lyra_login::LyraAuth;
use lyra_model_provider_info::ModelProviderInfo;

use crate::auth::auth_manager_for_provider;
use crate::auth::resolve_provider_auth;

/// Runtime provider abstraction used by model execution.
///
/// Implementations own provider-specific behavior for a model backend. The
/// `ModelProviderInfo` returned by `info` is the serialized/configured provider
/// metadata used by the default OpenAI-compatible implementation.
#[async_trait::async_trait]
pub trait ModelProvider: fmt::Debug + Send + Sync {
    /// Returns the configured provider metadata.
    fn info(&self) -> &ModelProviderInfo;

    /// Returns the provider-scoped auth manager, when this provider uses one.
    ///
    /// TODO(celia-oai): Make auth manager access internal to this crate so callers
    /// resolve provider-specific auth only through `ModelProvider`. We first need
    /// to think through whether Lyra should have a unified provider-specific auth
    /// manager throughout the codebase; that is a larger refactor than this change.
    fn auth_manager(&self) -> Option<Arc<AuthManager>>;

    /// Returns the current provider-scoped auth value, if one is configured.
    async fn auth(&self) -> Option<LyraAuth>;

    /// Returns provider configuration adapted for the API client.
    async fn api_provider(&self) -> lyra_protocol::error::Result<Provider> {
        let auth = self.auth().await;
        self.info()
            .to_api_provider(auth.as_ref().map(LyraAuth::auth_mode))
    }

    /// Returns the auth provider used to attach request credentials.
    async fn api_auth(&self) -> lyra_protocol::error::Result<SharedAuthProvider> {
        let auth = self.auth().await;
        resolve_provider_auth(auth.as_ref(), self.info())
    }
}

/// Shared runtime model provider handle.
pub type SharedModelProvider = Arc<dyn ModelProvider>;

/// Creates the default runtime model provider for configured provider metadata.
pub fn create_model_provider(
    provider_info: ModelProviderInfo,
    auth_manager: Option<Arc<AuthManager>>,
) -> SharedModelProvider {
    let auth_manager = auth_manager_for_provider(auth_manager, &provider_info);
    Arc::new(ConfiguredModelProvider {
        info: provider_info,
        auth_manager,
    })
}

/// Runtime model provider backed by configured `ModelProviderInfo`.
#[derive(Clone, Debug)]
struct ConfiguredModelProvider {
    info: ModelProviderInfo,
    auth_manager: Option<Arc<AuthManager>>,
}

#[async_trait::async_trait]
impl ModelProvider for ConfiguredModelProvider {
    fn info(&self) -> &ModelProviderInfo {
        &self.info
    }

    fn auth_manager(&self) -> Option<Arc<AuthManager>> {
        self.auth_manager.clone()
    }

    async fn auth(&self) -> Option<LyraAuth> {
        match self.auth_manager.as_ref() {
            Some(auth_manager) => auth_manager.auth().await,
            None => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;

    use lyra_protocol::config_types::ModelProviderAuthInfo;

    use super::*;

    fn provider_info_with_command_auth() -> ModelProviderInfo {
        ModelProviderInfo {
            auth: Some(ModelProviderAuthInfo {
                command: "print-token".to_string(),
                args: Vec::new(),
                timeout_ms: NonZeroU64::new(5_000).expect("timeout should be non-zero"),
                refresh_interval_ms: 300_000,
                cwd: std::env::current_dir()
                    .expect("current dir should be available")
                    .try_into()
                    .expect("current dir should be absolute"),
            }),
            requires_managed_auth: false,
            ..ModelProviderInfo::create_openai_provider(/*base_url*/ None)
        }
    }

    #[test]
    fn create_model_provider_builds_command_auth_manager_without_base_manager() {
        let provider = create_model_provider(
            provider_info_with_command_auth(),
            /*auth_manager*/ None,
        );

        let auth_manager = provider
            .auth_manager()
            .expect("command auth provider should have an auth manager");

        assert!(auth_manager.has_external_auth());
    }
}
