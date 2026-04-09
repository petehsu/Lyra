use crate::catalog::{cloud, custom, local, openai_family};
use crate::profile::types::{AiProviderCatalogItem, AiProviderPreset};

pub fn read_preset_catalog() -> Vec<AiProviderPreset> {
    let mut presets = Vec::new();
    presets.extend(openai_family::presets());
    presets.extend(cloud::presets());
    presets.extend(local::presets());
    presets.extend(custom::presets());
    presets
}

pub fn read_provider_catalog() -> Vec<AiProviderCatalogItem> {
    let mut items = Vec::<AiProviderCatalogItem>::new();
    for preset in read_preset_catalog() {
        if items.iter().any(|item| item.id == preset.provider_id) {
            continue;
        }
        items.push(AiProviderCatalogItem {
            id: preset.provider_id.clone(),
            label: preset.label.clone(),
            description: preset.description.clone(),
            protocol_id: preset.protocol_id.clone(),
            icon_key: preset.icon_key.clone(),
            recommended: preset.section == "recommended",
        });
    }
    items
}

pub fn find_preset(preset_id: &str) -> Option<AiProviderPreset> {
    read_preset_catalog()
        .into_iter()
        .find(|preset| preset.id == preset_id)
}
