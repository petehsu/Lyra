use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RenderedMcpToolApprovalTemplate {
    pub(crate) question: String,
    pub(crate) elicitation_message: String,
    pub(crate) tool_params: Option<Value>,
    pub(crate) tool_params_display: Vec<RenderedMcpToolApprovalParam>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct RenderedMcpToolApprovalParam {
    pub(crate) name: String,
    pub(crate) value: Value,
    pub(crate) display_name: String,
}

pub(crate) fn render_mcp_tool_approval_template(
    _server_name: &str,
    _connector_id: Option<&str>,
    _connector_name: Option<&str>,
    _tool_title: Option<&str>,
    _tool_params: Option<&Value>,
) -> Option<RenderedMcpToolApprovalTemplate> {
    None
}
