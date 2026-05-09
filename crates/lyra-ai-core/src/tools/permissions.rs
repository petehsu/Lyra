use super::permissions_hardcoded;
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolPermissionDecision {
    Allow,
    Deny(String),
    Confirm,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ToolPermissionRuleSet {
    pub tools: BTreeSet<String>,
}

impl ToolPermissionRuleSet {
    pub fn contains(&self, tool_name: &str) -> bool {
        self.tools.contains(tool_name)
    }

    pub fn from_tools(tools: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            tools: tools.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolPermissionPolicy {
    pub always_allow: ToolPermissionRuleSet,
    pub always_deny: ToolPermissionRuleSet,
    pub always_confirm: ToolPermissionRuleSet,
    pub default: ToolPermissionDecision,
}

impl Default for ToolPermissionPolicy {
    fn default() -> Self {
        Self {
            always_allow: ToolPermissionRuleSet::from_tools([
                "read_file",
                "list_directory",
                "search_text",
                "find_path",
                "git_status",
                "git_diff",
                "update_plan",
                "open_clarification_panel",
                "fetch_url",
                "web_search",
            ]),
            always_deny: ToolPermissionRuleSet::default(),
            always_confirm: ToolPermissionRuleSet::from_tools([
                "edit_file",
                "terminal",
                "write_file",
                "delete_path",
                "move_path",
                "create_directory",
            ]),
            default: ToolPermissionDecision::Confirm,
        }
    }
}

pub fn decide_tool_permission(
    tool_name: &str,
    arguments: &Value,
    policy: &ToolPermissionPolicy,
) -> ToolPermissionDecision {
    if let Some(reason) = permissions_hardcoded::hardcoded_deny_reason(tool_name, arguments) {
        return ToolPermissionDecision::Deny(reason);
    }
    if policy.always_deny.contains(tool_name) {
        return ToolPermissionDecision::Deny(format!("{tool_name} is denied by policy"));
    }
    if policy.always_confirm.contains(tool_name) {
        return ToolPermissionDecision::Confirm;
    }
    if policy.always_allow.contains(tool_name) {
        return ToolPermissionDecision::Allow;
    }
    policy.default.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hardcoded_deny_takes_priority_over_allow() {
        let policy = ToolPermissionPolicy {
            always_allow: ToolPermissionRuleSet::from_tools(["terminal"]),
            always_deny: ToolPermissionRuleSet::default(),
            always_confirm: ToolPermissionRuleSet::default(),
            default: ToolPermissionDecision::Allow,
        };

        let decision =
            decide_tool_permission("terminal", &json!({ "argv": ["rm", "-rf", "/"] }), &policy);

        assert!(matches!(decision, ToolPermissionDecision::Deny(_)));
    }

    #[test]
    fn explicit_rule_order_is_deny_confirm_allow_default() {
        let policy = ToolPermissionPolicy {
            always_allow: ToolPermissionRuleSet::from_tools(["write_file", "read_file"]),
            always_deny: ToolPermissionRuleSet::from_tools(["write_file"]),
            always_confirm: ToolPermissionRuleSet::from_tools(["read_file"]),
            default: ToolPermissionDecision::Deny("default deny".to_string()),
        };

        assert!(matches!(
            decide_tool_permission("write_file", &json!({}), &policy),
            ToolPermissionDecision::Deny(_)
        ));
        assert_eq!(
            decide_tool_permission("read_file", &json!({}), &policy),
            ToolPermissionDecision::Confirm
        );
        assert!(matches!(
            decide_tool_permission("unknown", &json!({}), &policy),
            ToolPermissionDecision::Deny(_)
        ));
    }
}
