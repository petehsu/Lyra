pub mod auth;
pub mod auth_env_telemetry;

pub use lyra_client::BuildCustomCaTransportError as BuildLoginHttpClientError;
pub use lyra_config::types::AuthCredentialsStoreMode;

pub use auth::AuthConfig;
pub use auth::AuthDotJson;
pub use auth::AuthManager;
pub use auth::AuthManagerConfig;
pub use auth::ExternalAuth;
pub use auth::ExternalAuthRefreshContext;
pub use auth::ExternalAuthRefreshReason;
pub use auth::ExternalAuthTokens;
pub use auth::LYRA_API_KEY_ENV_VAR;
pub use auth::LyraAuth;
pub use auth::OPENAI_API_KEY_ENV_VAR;
pub use auth::RefreshTokenError;
pub use auth::UnauthorizedRecovery;
pub use auth::default_client;
pub use auth::enforce_login_restrictions;
pub use auth::load_auth_dot_json;
pub use auth::login_with_api_key;
pub use auth::logout;
pub use auth::logout_with_revoke;
pub use auth::read_openai_api_key_from_env;
pub use auth::save_auth;
pub use auth_env_telemetry::AuthEnvTelemetry;
pub use auth_env_telemetry::collect_auth_env_telemetry;
