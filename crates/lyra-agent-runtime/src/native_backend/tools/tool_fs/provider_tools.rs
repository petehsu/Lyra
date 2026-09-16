use super::*;

pub(crate) fn is_tool_fs_model_tool(name: &str) -> bool {
    PROVIDER_VISIBLE_TOOL_NAMES.contains(&name)
}

pub(crate) fn model_tool_names() -> Vec<String> {
    provider_tool_names()
}

pub(crate) fn model_provider_tools() -> Vec<Value> {
    Vec::new()
}

pub(crate) fn root_summary_for_scene(
    scene: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    runtime_registry_with_dispatcher(dispatcher).root_summary_for_scene(ToolScene::parse(scene))
}

pub(crate) fn pinned_handles_for_scene(
    scene: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    serde_json::to_value(
        runtime_registry_with_dispatcher(dispatcher).pinned_handles(ToolScene::parse(scene)),
    )
    .unwrap_or_else(|_| json!([]))
}
