use lyra_config::types::McpServerConfig;

mod discoverable;
mod injection;
mod installed_marketplaces;
mod manager;
mod marketplace_add;
mod marketplace_remove;
mod mentions;
mod render;
#[cfg(test)]
pub(crate) mod test_support;

pub use lyra_core_plugins::marketplace_upgrade::ConfiguredMarketplaceUpgradeError as PluginMarketplaceUpgradeError;
pub use lyra_core_plugins::marketplace_upgrade::ConfiguredMarketplaceUpgradeOutcome as PluginMarketplaceUpgradeOutcome;
pub use lyra_plugin::AppConnectorId;
pub use lyra_plugin::EffectiveSkillRoots;
pub use lyra_plugin::PluginCapabilitySummary;
pub use lyra_plugin::PluginId;
pub use lyra_plugin::PluginIdError;
pub use lyra_plugin::PluginTelemetryMetadata;
pub use lyra_plugin::validate_plugin_segment;

pub type LoadedPlugin = lyra_plugin::LoadedPlugin<McpServerConfig>;
pub type PluginLoadOutcome = lyra_plugin::PluginLoadOutcome<McpServerConfig>;

pub(crate) use discoverable::list_tool_suggest_discoverable_plugins;
pub(crate) use injection::build_plugin_injections;
pub use installed_marketplaces::INSTALLED_MARKETPLACES_DIR;
pub use installed_marketplaces::marketplace_install_root;
pub use manager::ConfiguredMarketplace;
pub use manager::ConfiguredMarketplaceListOutcome;
pub use manager::ConfiguredMarketplacePlugin;
pub use manager::OPENAI_BUNDLED_MARKETPLACE_NAME;
pub use manager::PluginDetail;
pub use manager::PluginDetailsUnavailableReason;
pub use manager::PluginInstallError;
pub use manager::PluginInstallOutcome;
pub use manager::PluginInstallRequest;
pub use manager::PluginReadOutcome;
pub use manager::PluginReadRequest;
pub use manager::PluginUninstallError;
pub use manager::PluginsManager;
pub use marketplace_add::MarketplaceAddError;
pub use marketplace_add::MarketplaceAddOutcome;
pub use marketplace_add::MarketplaceAddRequest;
pub use marketplace_add::add_marketplace;
pub use marketplace_remove::MarketplaceRemoveError;
pub use marketplace_remove::MarketplaceRemoveOutcome;
pub use marketplace_remove::MarketplaceRemoveRequest;
pub use marketplace_remove::remove_marketplace;
pub(crate) use render::render_explicit_plugin_instructions;
pub(crate) use render::render_plugins_section;

pub(crate) use mentions::build_connector_slug_counts;
pub(crate) use mentions::build_skill_name_counts;
pub(crate) use mentions::collect_explicit_app_ids;
pub(crate) use mentions::collect_explicit_plugin_mentions;
pub(crate) use mentions::collect_tool_mentions_from_messages;
