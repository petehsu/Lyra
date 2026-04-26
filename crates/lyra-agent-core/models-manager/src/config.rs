use std::collections::HashMap;

use lyra_protocol::openai_models::ModelInfo;
use lyra_protocol::openai_models::ModelsResponse;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProviderModelCatalog {
    pub protocol_id: Option<String>,
    pub models: Vec<ModelInfo>,
}

#[derive(Debug, Clone, Default)]
pub struct ModelsManagerConfig {
    pub model_context_window: Option<i64>,
    pub tool_output_token_limit: Option<usize>,
    pub base_instructions: Option<String>,
    pub model_supports_reasoning_summaries: Option<bool>,
    pub model_catalog: Option<ModelsResponse>,
    pub provider_model_catalogs: HashMap<String, ProviderModelCatalog>,
}
