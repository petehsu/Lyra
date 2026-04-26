use std::sync::Arc;

use lyra_api::SharedAuthProvider;
use lyra_login::AuthManager;
use lyra_login::LyraAuth;
use lyra_model_provider_info::ModelProviderInfo;

use crate::bearer_auth_provider::BearerAuthProvider;

/// Returns the provider-scoped auth manager when this provider uses command-backed auth.
///
/// Providers without custom auth continue using the caller-supplied base manager, when present.
pub(crate) fn auth_manager_for_provider(
    auth_manager: Option<Arc<AuthManager>>,
    provider: &ModelProviderInfo,
) -> Option<Arc<AuthManager>> {
    match provider.auth.clone() {
        Some(config) => Some(AuthManager::external_bearer_only(config)),
        None => auth_manager,
    }
}

fn bearer_auth_provider_from_auth(
    auth: Option<&LyraAuth>,
    provider: &ModelProviderInfo,
) -> lyra_protocol::error::Result<BearerAuthProvider> {
    if let Some(api_key) = provider.api_key()? {
        return Ok(BearerAuthProvider {
            token: Some(api_key),
        });
    }

    if let Some(token) = provider.bearer_token.clone() {
        return Ok(BearerAuthProvider { token: Some(token) });
    }

    if let Some(auth) = auth {
        let token = auth.get_token()?;
        Ok(BearerAuthProvider { token: Some(token) })
    } else {
        Ok(BearerAuthProvider { token: None })
    }
}

pub(crate) fn resolve_provider_auth(
    auth: Option<&LyraAuth>,
    provider: &ModelProviderInfo,
) -> lyra_protocol::error::Result<SharedAuthProvider> {
    Ok(Arc::new(bearer_auth_provider_from_auth(auth, provider)?))
}
