use lyra_app_server_protocol::AppInfo;
use lyra_protocol::protocol::APPS_INSTRUCTIONS_CLOSE_TAG;
use lyra_protocol::protocol::APPS_INSTRUCTIONS_OPEN_TAG;

const LYRA_APPS_MCP_SERVER_NAME: &str = "lyra_apps";

pub(crate) fn render_apps_section(connectors: &[AppInfo]) -> Option<String> {
    connectors
        .iter()
        .any(|connector| connector.is_accessible && connector.is_enabled)
        .then(|| {
            format!(
                "{APPS_INSTRUCTIONS_OPEN_TAG}\n{}\n{APPS_INSTRUCTIONS_CLOSE_TAG}",
                apps_instructions_body()
            )
        })
}

fn apps_instructions_body() -> String {
    format!(
        "## Apps (Connectors)\nApps (Connectors) can be explicitly triggered in user messages in the format `[$app-name](app://{{connector_id}})`. Apps can also be implicitly triggered as long as the context suggests usage of available apps.\nAn app is equivalent to a set of MCP tools within the `{LYRA_APPS_MCP_SERVER_NAME}` MCP.\nAn installed app's MCP tools are either provided to you already, or can be lazy-loaded through the `tool_search` tool. If `tool_search` is available, the apps that are searchable by `tool_search` will be listed by it.\nDo not additionally call list_mcp_resources or list_mcp_resource_templates for apps."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connector(id: &str, is_accessible: bool, is_enabled: bool) -> AppInfo {
        AppInfo {
            id: id.to_string(),
            name: id.to_string(),
            description: None,
            logo_url: None,
            logo_url_dark: None,
            distribution_channel: None,
            branding: None,
            app_metadata: None,
            labels: None,
            install_url: None,
            is_accessible,
            is_enabled,
            plugin_display_names: Vec::new(),
        }
    }

    #[test]
    fn omits_apps_section_without_accessible_and_enabled_apps() {
        assert_eq!(render_apps_section(&[]), None);
        assert_eq!(
            render_apps_section(&[connector(
                "calendar", /*is_accessible*/ true, /*is_enabled*/ false
            )]),
            None
        );
        assert_eq!(
            render_apps_section(&[connector(
                "calendar", /*is_accessible*/ false, /*is_enabled*/ true
            )]),
            None
        );
    }

    #[test]
    fn renders_apps_section_with_an_accessible_and_enabled_app() {
        let rendered = render_apps_section(&[connector(
            "calendar", /*is_accessible*/ true, /*is_enabled*/ true,
        )])
        .expect("expected apps section");

        assert!(rendered.starts_with(APPS_INSTRUCTIONS_OPEN_TAG));
        assert!(rendered.contains("## Apps (Connectors)"));
        assert!(rendered.ends_with(APPS_INSTRUCTIONS_CLOSE_TAG));
    }
}
