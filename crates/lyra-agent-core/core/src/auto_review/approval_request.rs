use std::path::Path;

use lyra_protocol::approvals::AutoReviewAssessmentAction;
use lyra_protocol::approvals::AutoReviewCommandSource;
use lyra_protocol::approvals::NetworkApprovalProtocol;
use lyra_protocol::models::PermissionProfile;
use lyra_utils_absolute_path::AbsolutePathBuf;
use serde::Serialize;
use serde_json::Value;

use super::AUTO_REVIEW_MAX_ACTION_STRING_TOKENS;
use super::prompt::auto_review_truncate_text;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AutoReviewApprovalRequest {
    Shell {
        id: String,
        command: Vec<String>,
        cwd: AbsolutePathBuf,
        sandbox_permissions: crate::sandboxing::SandboxPermissions,
        additional_permissions: Option<PermissionProfile>,
        justification: Option<String>,
    },
    ExecCommand {
        id: String,
        command: Vec<String>,
        cwd: AbsolutePathBuf,
        sandbox_permissions: crate::sandboxing::SandboxPermissions,
        additional_permissions: Option<PermissionProfile>,
        justification: Option<String>,
        tty: bool,
    },
    #[cfg(unix)]
    Execve {
        id: String,
        source: AutoReviewCommandSource,
        program: String,
        argv: Vec<String>,
        cwd: AbsolutePathBuf,
        additional_permissions: Option<PermissionProfile>,
    },
    ApplyPatch {
        id: String,
        cwd: AbsolutePathBuf,
        files: Vec<AbsolutePathBuf>,
        patch: String,
    },
    NetworkAccess {
        id: String,
        turn_id: String,
        target: String,
        host: String,
        protocol: NetworkApprovalProtocol,
        port: u16,
    },
    McpToolCall {
        id: String,
        server: String,
        tool_name: String,
        arguments: Option<Value>,
        connector_id: Option<String>,
        connector_name: Option<String>,
        connector_description: Option<String>,
        tool_title: Option<String>,
        tool_description: Option<String>,
        annotations: Option<AutoReviewMcpAnnotations>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct AutoReviewMcpAnnotations {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) destructive_hint: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) open_world_hint: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) read_only_hint: Option<bool>,
}

#[derive(Serialize)]
struct CommandApprovalAction<'a> {
    tool: &'a str,
    command: &'a [String],
    cwd: &'a Path,
    sandbox_permissions: crate::sandboxing::SandboxPermissions,
    #[serde(skip_serializing_if = "Option::is_none")]
    additional_permissions: Option<&'a PermissionProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    justification: Option<&'a String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tty: Option<bool>,
}

#[cfg(unix)]
#[derive(Serialize)]
struct ExecveApprovalAction<'a> {
    tool: &'a str,
    program: &'a str,
    argv: &'a [String],
    cwd: &'a Path,
    #[serde(skip_serializing_if = "Option::is_none")]
    additional_permissions: Option<&'a PermissionProfile>,
}

#[derive(Serialize)]
struct McpToolCallApprovalAction<'a> {
    tool: &'static str,
    server: &'a str,
    tool_name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    arguments: Option<&'a Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connector_id: Option<&'a String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connector_name: Option<&'a String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connector_description: Option<&'a String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_title: Option<&'a String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_description: Option<&'a String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    annotations: Option<&'a AutoReviewMcpAnnotations>,
}

fn serialize_auto_review_action(value: impl Serialize) -> serde_json::Result<Value> {
    serde_json::to_value(value)
}

fn serialize_command_auto_review_action(
    tool: &'static str,
    command: &[String],
    cwd: &Path,
    sandbox_permissions: crate::sandboxing::SandboxPermissions,
    additional_permissions: Option<&PermissionProfile>,
    justification: Option<&String>,
    tty: Option<bool>,
) -> serde_json::Result<Value> {
    serialize_auto_review_action(CommandApprovalAction {
        tool,
        command,
        cwd,
        sandbox_permissions,
        additional_permissions,
        justification,
        tty,
    })
}

fn command_assessment_action(
    source: AutoReviewCommandSource,
    command: &[String],
    cwd: &AbsolutePathBuf,
) -> AutoReviewAssessmentAction {
    AutoReviewAssessmentAction::Command {
        source,
        command: lyra_shell_command::parse_command::shlex_join(command),
        cwd: cwd.clone(),
    }
}

#[cfg(unix)]
fn auto_review_command_source_tool_name(source: AutoReviewCommandSource) -> &'static str {
    match source {
        AutoReviewCommandSource::Shell => "shell",
        AutoReviewCommandSource::UnifiedExec => "exec_command",
    }
}

fn truncate_auto_review_action_value(value: Value) -> Value {
    match value {
        Value::String(text) => Value::String(auto_review_truncate_text(
            &text,
            AUTO_REVIEW_MAX_ACTION_STRING_TOKENS,
        )),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(truncate_auto_review_action_value)
                .collect::<Vec<_>>(),
        ),
        Value::Object(values) => {
            let mut entries = values.into_iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, truncate_auto_review_action_value(value)))
                    .collect(),
            )
        }
        other => other,
    }
}

pub(crate) fn auto_review_approval_request_to_json(
    action: &AutoReviewApprovalRequest,
) -> serde_json::Result<Value> {
    match action {
        AutoReviewApprovalRequest::Shell {
            id: _,
            command,
            cwd,
            sandbox_permissions,
            additional_permissions,
            justification,
        } => serialize_command_auto_review_action(
            "shell",
            command,
            cwd,
            *sandbox_permissions,
            additional_permissions.as_ref(),
            justification.as_ref(),
            /*tty*/ None,
        ),
        AutoReviewApprovalRequest::ExecCommand {
            id: _,
            command,
            cwd,
            sandbox_permissions,
            additional_permissions,
            justification,
            tty,
        } => serialize_command_auto_review_action(
            "exec_command",
            command,
            cwd,
            *sandbox_permissions,
            additional_permissions.as_ref(),
            justification.as_ref(),
            Some(*tty),
        ),
        #[cfg(unix)]
        AutoReviewApprovalRequest::Execve {
            id: _,
            source,
            program,
            argv,
            cwd,
            additional_permissions,
        } => serialize_auto_review_action(ExecveApprovalAction {
            tool: auto_review_command_source_tool_name(*source),
            program,
            argv,
            cwd,
            additional_permissions: additional_permissions.as_ref(),
        }),
        AutoReviewApprovalRequest::ApplyPatch {
            id: _,
            cwd,
            files,
            patch,
        } => Ok(serde_json::json!({
            "tool": "apply_patch",
            "cwd": cwd,
            "files": files,
            "patch": patch,
        })),
        AutoReviewApprovalRequest::NetworkAccess {
            id: _,
            turn_id: _,
            target,
            host,
            protocol,
            port,
        } => Ok(serde_json::json!({
            "tool": "network_access",
            "target": target,
            "host": host,
            "protocol": protocol,
            "port": port,
        })),
        AutoReviewApprovalRequest::McpToolCall {
            id: _,
            server,
            tool_name,
            arguments,
            connector_id,
            connector_name,
            connector_description,
            tool_title,
            tool_description,
            annotations,
        } => serialize_auto_review_action(McpToolCallApprovalAction {
            tool: "mcp_tool_call",
            server,
            tool_name,
            arguments: arguments.as_ref(),
            connector_id: connector_id.as_ref(),
            connector_name: connector_name.as_ref(),
            connector_description: connector_description.as_ref(),
            tool_title: tool_title.as_ref(),
            tool_description: tool_description.as_ref(),
            annotations: annotations.as_ref(),
        }),
    }
}

pub(crate) fn auto_review_assessment_action(
    action: &AutoReviewApprovalRequest,
) -> AutoReviewAssessmentAction {
    match action {
        AutoReviewApprovalRequest::Shell { command, cwd, .. } => {
            command_assessment_action(AutoReviewCommandSource::Shell, command, cwd)
        }
        AutoReviewApprovalRequest::ExecCommand { command, cwd, .. } => {
            command_assessment_action(AutoReviewCommandSource::UnifiedExec, command, cwd)
        }
        #[cfg(unix)]
        AutoReviewApprovalRequest::Execve {
            source,
            program,
            argv,
            cwd,
            ..
        } => AutoReviewAssessmentAction::Execve {
            source: *source,
            program: program.clone(),
            argv: argv.clone(),
            cwd: cwd.clone(),
        },
        AutoReviewApprovalRequest::ApplyPatch { cwd, files, .. } => {
            AutoReviewAssessmentAction::ApplyPatch {
                cwd: cwd.clone(),
                files: files.clone(),
            }
        }
        AutoReviewApprovalRequest::NetworkAccess {
            id: _,
            turn_id: _,
            target,
            host,
            protocol,
            port,
        } => AutoReviewAssessmentAction::NetworkAccess {
            target: target.clone(),
            host: host.clone(),
            protocol: *protocol,
            port: *port,
        },
        AutoReviewApprovalRequest::McpToolCall {
            server,
            tool_name,
            connector_id,
            connector_name,
            tool_title,
            ..
        } => AutoReviewAssessmentAction::McpToolCall {
            server: server.clone(),
            tool_name: tool_name.clone(),
            connector_id: connector_id.clone(),
            connector_name: connector_name.clone(),
            tool_title: tool_title.clone(),
        },
    }
}

pub(crate) fn auto_review_request_target_item_id(
    request: &AutoReviewApprovalRequest,
) -> Option<&str> {
    match request {
        AutoReviewApprovalRequest::Shell { id, .. }
        | AutoReviewApprovalRequest::ExecCommand { id, .. }
        | AutoReviewApprovalRequest::ApplyPatch { id, .. }
        | AutoReviewApprovalRequest::McpToolCall { id, .. } => Some(id),
        AutoReviewApprovalRequest::NetworkAccess { .. } => None,
        #[cfg(unix)]
        AutoReviewApprovalRequest::Execve { id, .. } => Some(id),
    }
}

pub(crate) fn auto_review_request_turn_id<'a>(
    request: &'a AutoReviewApprovalRequest,
    default_turn_id: &'a str,
) -> &'a str {
    match request {
        AutoReviewApprovalRequest::NetworkAccess { turn_id, .. } => turn_id,
        AutoReviewApprovalRequest::Shell { .. }
        | AutoReviewApprovalRequest::ExecCommand { .. }
        | AutoReviewApprovalRequest::ApplyPatch { .. }
        | AutoReviewApprovalRequest::McpToolCall { .. } => default_turn_id,
        #[cfg(unix)]
        AutoReviewApprovalRequest::Execve { .. } => default_turn_id,
    }
}

pub(crate) fn format_auto_review_action_pretty(
    action: &AutoReviewApprovalRequest,
) -> serde_json::Result<String> {
    let mut value = auto_review_approval_request_to_json(action)?;
    value = truncate_auto_review_action_value(value);
    serde_json::to_string_pretty(&value)
}
