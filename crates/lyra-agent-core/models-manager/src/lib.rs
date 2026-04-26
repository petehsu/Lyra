pub(crate) mod cache;
pub mod collaboration_mode_presets;
pub(crate) mod config;
pub mod manager;
pub mod model_info;
pub mod model_presets;
pub mod runtime_metadata;

pub use config::ModelsManagerConfig;
pub use config::ProviderModelCatalog;
pub use lyra_app_server_protocol::AuthMode;
pub use lyra_login::AuthManager;
pub use lyra_login::LyraAuth;
pub use lyra_model_provider_info::ModelProviderInfo;
pub use lyra_model_provider_info::WireApi;
pub use runtime_metadata::model_info_for_provider_protocol;
pub use runtime_metadata::model_info_from_provider_model_entry;
pub use runtime_metadata::normalize_provider_model_entry;
pub use runtime_metadata::provider_model_entry_from_id;
pub use runtime_metadata::runtime_metadata_from_model_info;

/// Load the bundled model catalog shipped with `lyra-models-manager`.
pub fn bundled_models_response()
-> std::result::Result<lyra_protocol::openai_models::ModelsResponse, serde_json::Error> {
    serde_json::from_str(include_str!("../models.json"))
}

/// Convert the client version string to a whole version string (e.g. "1.2.3-alpha.4" -> "1.2.3").
pub fn client_version_to_whole() -> String {
    format!(
        "{}.{}.{}",
        env!("CARGO_PKG_VERSION_MAJOR"),
        env!("CARGO_PKG_VERSION_MINOR"),
        env!("CARGO_PKG_VERSION_PATCH")
    )
}
