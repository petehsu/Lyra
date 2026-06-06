use lyra_tool_fs_core::{ToolManifest, ToolManifestProvider, attach_schema_id};
use serde_json::json;

pub(crate) struct TestManifestProvider {
    pub(crate) manifests: Vec<ToolManifest>,
}

impl ToolManifestProvider for TestManifestProvider {
    fn tool_manifests(&self) -> Vec<ToolManifest> {
        self.manifests.clone()
    }
}

pub(crate) fn test_manifest(path: &str, handle: Option<&str>) -> ToolManifest {
    let domain = path
        .trim_start_matches("/tools/")
        .split('/')
        .next()
        .unwrap_or("test");
    ToolManifest {
        path: path.to_string(),
        handle: handle.map(str::to_string),
        domain: domain.to_string(),
        operation: "read".to_string(),
        title: "Test tool".to_string(),
        summary: "A test tool.".to_string(),
        description: "Test tool description for search.".to_string(),
        aliases: vec!["test read".to_string()],
        examples: vec!["Use this test tool.".to_string()],
        tags: vec!["test".to_string()],
        risk_level: "read".to_string(),
        permission_policy: "runtime_policy".to_string(),
        input_schema: attach_schema_id(path, json!({ "type": "object", "properties": {} })),
        output_kind: "json".to_string(),
        activity_kind: "task".to_string(),
        renderer_hint: "task".to_string(),
    }
}
