use async_trait::async_trait;
use std::env;
use std::fmt::Debug;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;
use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;
use tokio::sync::watch;

use lyra_app_server_protocol::AuthMode;
use lyra_app_server_protocol::AuthMode as ApiAuthMode;
use lyra_config::types::AuthCredentialsStoreMode;
use lyra_protocol::auth::RefreshTokenFailedError;
use lyra_protocol::auth::RefreshTokenFailedReason;
use lyra_protocol::config_types::ForcedLoginMethod;
use lyra_protocol::config_types::ModelProviderAuthInfo;

use super::external_bearer::BearerTokenRefresher;
pub use crate::auth::storage::AuthDotJson;
use crate::auth::storage::create_auth_storage;

/// Authentication mechanism used by the current runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LyraAuth {
    ApiKey(ApiKeyAuth),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiKeyAuth {
    api_key: String,
}

#[derive(Debug, Error)]
pub enum RefreshTokenError {
    #[error("{0}")]
    Permanent(#[from] RefreshTokenFailedError),
    #[error(transparent)]
    Transient(#[from] std::io::Error),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalAuthTokens {
    pub access_token: String,
}

impl ExternalAuthTokens {
    pub fn access_token_only(access_token: impl Into<String>) -> Self {
        Self {
            access_token: access_token.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalAuthRefreshReason {
    Unauthorized,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalAuthRefreshContext {
    pub reason: ExternalAuthRefreshReason,
}

#[async_trait]
pub trait ExternalAuth: Send + Sync {
    fn auth_mode(&self) -> AuthMode;

    async fn resolve(&self) -> std::io::Result<Option<ExternalAuthTokens>> {
        Ok(None)
    }

    async fn refresh(
        &self,
        context: ExternalAuthRefreshContext,
    ) -> std::io::Result<ExternalAuthTokens>;
}

impl RefreshTokenError {
    pub fn failed_reason(&self) -> Option<RefreshTokenFailedReason> {
        match self {
            Self::Permanent(error) => Some(error.reason),
            Self::Transient(_) => None,
        }
    }
}

impl From<RefreshTokenError> for std::io::Error {
    fn from(err: RefreshTokenError) -> Self {
        match err {
            RefreshTokenError::Permanent(failed) => std::io::Error::other(failed),
            RefreshTokenError::Transient(inner) => inner,
        }
    }
}

impl LyraAuth {
    fn from_auth_dot_json(auth_dot_json: AuthDotJson) -> std::io::Result<Self> {
        let Some(api_key) = auth_dot_json.openai_api_key else {
            return Err(std::io::Error::other(
                "managed OAuth auth is no longer supported",
            ));
        };
        Ok(Self::from_api_key(&api_key))
    }

    pub fn from_auth_storage(
        lyra_home: &Path,
        auth_credentials_store_mode: AuthCredentialsStoreMode,
    ) -> std::io::Result<Option<Self>> {
        load_auth(
            lyra_home,
            /*enable_lyra_api_key_env*/ false,
            auth_credentials_store_mode,
        )
    }

    pub fn auth_mode(&self) -> AuthMode {
        match self {
            Self::ApiKey(_) => AuthMode::ApiKey,
        }
    }

    pub fn api_auth_mode(&self) -> ApiAuthMode {
        match self {
            Self::ApiKey(_) => ApiAuthMode::ApiKey,
        }
    }

    pub fn is_api_key_auth(&self) -> bool {
        true
    }

    pub fn api_key(&self) -> Option<&str> {
        match self {
            Self::ApiKey(auth) => Some(auth.api_key.as_str()),
        }
    }

    pub fn get_token(&self) -> Result<String, std::io::Error> {
        match self {
            Self::ApiKey(auth) => Ok(auth.api_key.clone()),
        }
    }

    #[cfg(test)]
    pub fn create_dummy_api_key_auth_for_testing() -> Self {
        Self::from_api_key("test-api-key")
    }

    pub fn from_api_key(api_key: &str) -> Self {
        Self::ApiKey(ApiKeyAuth {
            api_key: api_key.to_owned(),
        })
    }
}

pub const LYRA_API_KEY_ENV_VAR: &str = "LYRA_API_KEY";
pub const OPENAI_API_KEY_ENV_VAR: &str = "OPENAI_API_KEY";

/// Read API key from environment, checking LYRA_API_KEY first, then OPENAI_API_KEY as fallback.
pub fn read_openai_api_key_from_env() -> Option<String> {
    // Primary: LYRA_API_KEY
    if let Some(key) = read_env_key(LYRA_API_KEY_ENV_VAR) {
        return Some(key);
    }
    // Fallback: OPENAI_API_KEY (backward compatibility)
    read_env_key(OPENAI_API_KEY_ENV_VAR)
}

pub fn read_lyra_api_key_from_env() -> Option<String> {
    read_env_key(LYRA_API_KEY_ENV_VAR)
}

fn read_env_key(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn logout(
    lyra_home: &Path,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
) -> std::io::Result<bool> {
    let storage = create_auth_storage(lyra_home.to_path_buf(), auth_credentials_store_mode);
    storage.delete()
}

pub async fn logout_with_revoke(
    lyra_home: &Path,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
) -> std::io::Result<bool> {
    logout(lyra_home, auth_credentials_store_mode)
}

pub fn login_with_api_key(
    lyra_home: &Path,
    api_key: &str,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
) -> std::io::Result<()> {
    let auth_dot_json = AuthDotJson {
        auth_mode: Some(ApiAuthMode::ApiKey),
        openai_api_key: Some(api_key.to_string()),
    };
    save_auth(lyra_home, &auth_dot_json, auth_credentials_store_mode)
}

pub fn save_auth(
    lyra_home: &Path,
    auth: &AuthDotJson,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
) -> std::io::Result<()> {
    let storage = create_auth_storage(lyra_home.to_path_buf(), auth_credentials_store_mode);
    storage.save(auth)
}

pub fn load_auth_dot_json(
    lyra_home: &Path,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
) -> std::io::Result<Option<AuthDotJson>> {
    let storage = create_auth_storage(lyra_home.to_path_buf(), auth_credentials_store_mode);
    storage.load()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthConfig {
    pub lyra_home: PathBuf,
    pub auth_credentials_store_mode: AuthCredentialsStoreMode,
    pub forced_login_method: Option<ForcedLoginMethod>,
}

pub fn enforce_login_restrictions(config: &AuthConfig) -> std::io::Result<()> {
    let Some(auth) = load_auth(
        &config.lyra_home,
        /*enable_lyra_api_key_env*/ true,
        config.auth_credentials_store_mode,
    )?
    else {
        return Ok(());
    };

    if matches!(config.forced_login_method, Some(ForcedLoginMethod::Api)) && !auth.is_api_key_auth()
    {
        return logout_with_message(
            &config.lyra_home,
            "API key login is required, but a non-API auth mode was configured. Logging out."
                .to_string(),
            config.auth_credentials_store_mode,
        );
    }

    Ok(())
}

fn logout_with_message(
    lyra_home: &Path,
    message: String,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
) -> std::io::Result<()> {
    let removal_result = logout_all_stores(lyra_home, auth_credentials_store_mode);
    let error_message = match removal_result {
        Ok(_) => message,
        Err(err) => format!("{message}. Failed to remove auth.json: {err}"),
    };
    Err(std::io::Error::other(error_message))
}

fn logout_all_stores(
    lyra_home: &Path,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
) -> std::io::Result<bool> {
    if auth_credentials_store_mode == AuthCredentialsStoreMode::Ephemeral {
        return logout(lyra_home, AuthCredentialsStoreMode::Ephemeral);
    }
    let removed_ephemeral = logout(lyra_home, AuthCredentialsStoreMode::Ephemeral)?;
    let removed_primary = logout(lyra_home, auth_credentials_store_mode)?;
    Ok(removed_ephemeral || removed_primary)
}

fn load_auth(
    lyra_home: &Path,
    enable_lyra_api_key_env: bool,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
) -> std::io::Result<Option<LyraAuth>> {
    if enable_lyra_api_key_env && let Some(api_key) = read_lyra_api_key_from_env() {
        return Ok(Some(LyraAuth::from_api_key(api_key.as_str())));
    }

    let storage = create_auth_storage(lyra_home.to_path_buf(), auth_credentials_store_mode);
    let auth_dot_json = match storage.load()? {
        Some(auth) => auth,
        None => return Ok(None),
    };

    Ok(Some(LyraAuth::from_auth_dot_json(auth_dot_json)?))
}

#[derive(Clone, Debug)]
struct CachedAuth {
    auth: Option<LyraAuth>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UnauthorizedRecoveryStep {
    ExternalRefresh,
    Done,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UnauthorizedRecoveryStepResult {
    auth_state_changed: Option<bool>,
}

impl UnauthorizedRecoveryStepResult {
    pub fn auth_state_changed(&self) -> Option<bool> {
        self.auth_state_changed
    }
}

pub struct UnauthorizedRecovery {
    manager: Arc<AuthManager>,
    step: UnauthorizedRecoveryStep,
}

impl UnauthorizedRecovery {
    fn new(manager: Arc<AuthManager>) -> Self {
        let step = if manager.has_external_auth() {
            UnauthorizedRecoveryStep::ExternalRefresh
        } else {
            UnauthorizedRecoveryStep::Done
        };
        Self { manager, step }
    }

    pub fn has_next(&self) -> bool {
        self.manager.has_external_auth() && self.step != UnauthorizedRecoveryStep::Done
    }

    pub fn unavailable_reason(&self) -> &'static str {
        if !self.manager.has_external_auth() {
            return "no_external_auth";
        }
        if self.step == UnauthorizedRecoveryStep::Done {
            return "recovery_exhausted";
        }
        "ready"
    }

    pub fn mode_name(&self) -> &'static str {
        "external"
    }

    pub fn step_name(&self) -> &'static str {
        match self.step {
            UnauthorizedRecoveryStep::ExternalRefresh => "external_refresh",
            UnauthorizedRecoveryStep::Done => "done",
        }
    }

    pub async fn next(&mut self) -> Result<UnauthorizedRecoveryStepResult, RefreshTokenError> {
        if !self.has_next() {
            return Err(RefreshTokenError::Permanent(RefreshTokenFailedError::new(
                RefreshTokenFailedReason::Other,
                "No more recovery steps available.",
            )));
        }

        self.manager
            .refresh_external_auth(ExternalAuthRefreshReason::Unauthorized)
            .await?;
        self.step = UnauthorizedRecoveryStep::Done;
        Ok(UnauthorizedRecoveryStepResult {
            auth_state_changed: Some(true),
        })
    }
}

pub struct AuthManager {
    lyra_home: PathBuf,
    inner: RwLock<CachedAuth>,
    enable_lyra_api_key_env: bool,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
    refresh_lock: AsyncMutex<()>,
    external_auth: RwLock<Option<Arc<dyn ExternalAuth>>>,
    auth_state_tx: watch::Sender<()>,
}

pub trait AuthManagerConfig {
    fn lyra_home(&self) -> PathBuf;

    fn cli_auth_credentials_store_mode(&self) -> AuthCredentialsStoreMode;
}

impl Debug for AuthManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthManager")
            .field("lyra_home", &self.lyra_home)
            .field(
                "inner",
                &self.inner.read().ok().map(|guard| guard.auth.clone()),
            )
            .field("enable_lyra_api_key_env", &self.enable_lyra_api_key_env)
            .field(
                "auth_credentials_store_mode",
                &self.auth_credentials_store_mode,
            )
            .field("has_external_auth", &self.has_external_auth())
            .finish_non_exhaustive()
    }
}

impl AuthManager {
    pub fn new(
        lyra_home: PathBuf,
        enable_lyra_api_key_env: bool,
        auth_credentials_store_mode: AuthCredentialsStoreMode,
    ) -> Self {
        let (auth_state_tx, _) = watch::channel(());
        let managed_auth = load_auth(
            &lyra_home,
            enable_lyra_api_key_env,
            auth_credentials_store_mode,
        )
        .ok()
        .flatten();
        Self {
            lyra_home,
            inner: RwLock::new(CachedAuth { auth: managed_auth }),
            enable_lyra_api_key_env,
            auth_credentials_store_mode,
            refresh_lock: AsyncMutex::new(()),
            external_auth: RwLock::new(None),
            auth_state_tx,
        }
    }

    pub fn from_auth_for_testing(auth: LyraAuth) -> Arc<Self> {
        let (auth_state_tx, _) = watch::channel(());
        Arc::new(Self {
            lyra_home: PathBuf::from("non-existent"),
            inner: RwLock::new(CachedAuth { auth: Some(auth) }),
            enable_lyra_api_key_env: false,
            auth_credentials_store_mode: AuthCredentialsStoreMode::File,
            refresh_lock: AsyncMutex::new(()),
            external_auth: RwLock::new(None),
            auth_state_tx,
        })
    }

    pub fn from_auth_for_testing_with_home(auth: LyraAuth, lyra_home: PathBuf) -> Arc<Self> {
        let (auth_state_tx, _) = watch::channel(());
        Arc::new(Self {
            lyra_home,
            inner: RwLock::new(CachedAuth { auth: Some(auth) }),
            enable_lyra_api_key_env: false,
            auth_credentials_store_mode: AuthCredentialsStoreMode::File,
            refresh_lock: AsyncMutex::new(()),
            external_auth: RwLock::new(None),
            auth_state_tx,
        })
    }

    pub fn external_bearer_only(config: ModelProviderAuthInfo) -> Arc<Self> {
        let (auth_state_tx, _) = watch::channel(());
        Arc::new(Self {
            lyra_home: PathBuf::from("non-existent"),
            inner: RwLock::new(CachedAuth { auth: None }),
            enable_lyra_api_key_env: false,
            auth_credentials_store_mode: AuthCredentialsStoreMode::File,
            refresh_lock: AsyncMutex::new(()),
            external_auth: RwLock::new(Some(
                Arc::new(BearerTokenRefresher::new(config)) as Arc<dyn ExternalAuth>
            )),
            auth_state_tx,
        })
    }

    pub fn auth_cached(&self) -> Option<LyraAuth> {
        self.inner.read().ok().and_then(|guard| guard.auth.clone())
    }

    pub async fn auth(&self) -> Option<LyraAuth> {
        if let Some(auth) = self.resolve_external_api_key_auth().await {
            return Some(auth);
        }
        self.auth_cached()
    }

    pub fn reload(&self) -> bool {
        let new_auth = self.load_auth_from_storage();
        self.set_cached_auth(new_auth)
    }

    fn auths_equal(a: Option<&LyraAuth>, b: Option<&LyraAuth>) -> bool {
        match (a, b) {
            (None, None) => true,
            (Some(a), Some(b)) => a == b,
            _ => false,
        }
    }

    fn load_auth_from_storage(&self) -> Option<LyraAuth> {
        load_auth(
            &self.lyra_home,
            self.enable_lyra_api_key_env,
            self.auth_credentials_store_mode,
        )
        .ok()
        .flatten()
    }

    fn set_cached_auth(&self, new_auth: Option<LyraAuth>) -> bool {
        if let Ok(mut guard) = self.inner.write() {
            let changed = !Self::auths_equal(guard.auth.as_ref(), new_auth.as_ref());
            guard.auth = new_auth;
            self.auth_state_tx.send_replace(());
            changed
        } else {
            false
        }
    }

    pub fn set_external_auth(&self, external_auth: Arc<dyn ExternalAuth>) {
        if let Ok(mut guard) = self.external_auth.write() {
            *guard = Some(external_auth);
            self.auth_state_tx.send_replace(());
        }
    }

    pub fn clear_external_auth(&self) {
        if let Ok(mut guard) = self.external_auth.write() {
            *guard = None;
            self.auth_state_tx.send_replace(());
        }
    }

    pub fn subscribe_auth_state(&self) -> watch::Receiver<()> {
        self.auth_state_tx.subscribe()
    }

    pub fn has_external_auth(&self) -> bool {
        self.external_auth().is_some()
    }

    pub fn lyra_api_key_env_enabled(&self) -> bool {
        self.enable_lyra_api_key_env
    }

    pub fn shared(
        lyra_home: PathBuf,
        enable_lyra_api_key_env: bool,
        auth_credentials_store_mode: AuthCredentialsStoreMode,
    ) -> Arc<Self> {
        Arc::new(Self::new(
            lyra_home,
            enable_lyra_api_key_env,
            auth_credentials_store_mode,
        ))
    }

    pub fn shared_from_config(
        config: &impl AuthManagerConfig,
        enable_lyra_api_key_env: bool,
    ) -> Arc<Self> {
        Self::shared(
            config.lyra_home(),
            enable_lyra_api_key_env,
            config.cli_auth_credentials_store_mode(),
        )
    }

    pub fn unauthorized_recovery(self: &Arc<Self>) -> UnauthorizedRecovery {
        UnauthorizedRecovery::new(Arc::clone(self))
    }

    fn external_auth(&self) -> Option<Arc<dyn ExternalAuth>> {
        self.external_auth
            .read()
            .ok()
            .and_then(|guard| guard.as_ref().cloned())
    }

    fn external_auth_mode(&self) -> Option<AuthMode> {
        self.external_auth().as_ref().map(|auth| auth.auth_mode())
    }

    fn has_external_api_key_auth(&self) -> bool {
        self.external_auth_mode() == Some(AuthMode::ApiKey)
    }

    async fn resolve_external_api_key_auth(&self) -> Option<LyraAuth> {
        if !self.has_external_api_key_auth() {
            return None;
        }

        let external_auth = self.external_auth()?;
        match external_auth.resolve().await {
            Ok(Some(tokens)) => Some(LyraAuth::from_api_key(&tokens.access_token)),
            Ok(None) => None,
            Err(err) => {
                tracing::error!("Failed to resolve external API key auth: {err}");
                None
            }
        }
    }

    pub async fn refresh_token(&self) -> Result<(), RefreshTokenError> {
        let _refresh_guard = self.refresh_lock.lock().await;
        self.refresh_external_auth(ExternalAuthRefreshReason::Unauthorized)
            .await
    }

    pub async fn refresh_token_from_authority(&self) -> Result<(), RefreshTokenError> {
        let _refresh_guard = self.refresh_lock.lock().await;
        self.refresh_external_auth(ExternalAuthRefreshReason::Unauthorized)
            .await
    }

    pub fn logout(&self) -> std::io::Result<bool> {
        let removed = logout_all_stores(&self.lyra_home, self.auth_credentials_store_mode)?;
        self.reload();
        Ok(removed)
    }

    pub async fn logout_with_revoke(&self) -> std::io::Result<bool> {
        self.logout()
    }

    pub fn get_api_auth_mode(&self) -> Option<ApiAuthMode> {
        if self.has_external_api_key_auth() {
            return Some(ApiAuthMode::ApiKey);
        }
        self.auth_cached().as_ref().map(LyraAuth::api_auth_mode)
    }

    pub fn auth_mode(&self) -> Option<AuthMode> {
        if let Some(mode) = self.external_auth_mode() {
            return Some(mode);
        }
        self.auth_cached().as_ref().map(LyraAuth::auth_mode)
    }

    async fn refresh_external_auth(
        &self,
        reason: ExternalAuthRefreshReason,
    ) -> Result<(), RefreshTokenError> {
        let Some(external_auth) = self.external_auth() else {
            return Ok(());
        };
        let context = ExternalAuthRefreshContext { reason };
        external_auth
            .refresh(context)
            .await
            .map(|_| ())
            .map_err(RefreshTokenError::Transient)
    }
}
