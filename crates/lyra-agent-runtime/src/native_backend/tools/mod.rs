use super::*;

// CodeGraphFragmentReport is exposed on PromptBuildReport (pub field),
// so the type must be reachable from integration tests.
pub use codegraph_signals::CodeGraphFragmentReport;

pub(crate) const APPLY_PATCH_MODEL_TOOL: &str = "apply_patch";
pub(crate) const READ_FILE_MODEL_TOOL: &str = "read_file";
pub(crate) const GREP_MODEL_TOOL: &str = "grep";
pub(crate) const GLOB_MODEL_TOOL: &str = "glob";
pub(crate) const EDIT_FILE_MODEL_TOOL: &str = "edit_file";
pub(crate) const WRITE_FILE_MODEL_TOOL: &str = "write_file";
pub(crate) const EXEC_COMMAND_MODEL_TOOL: &str = "exec_command";
pub(crate) const WRITE_STDIN_MODEL_TOOL: &str = "write_stdin";
pub(crate) const PLAN_BEGIN_MODEL_TOOL: &str = "plan_begin";
pub(crate) const PLAN_WRITE_MODEL_TOOL: &str = "plan_write";
pub(crate) const PLAN_FINALIZE_MODEL_TOOL: &str = "plan_finalize";
pub(crate) const PLAN_REVISE_MODEL_TOOL: &str = "plan_revise";
pub(crate) const TODO_WRITE_MODEL_TOOL: &str = "todo_write";
pub(crate) const TODO_UPDATE_MODEL_TOOL: &str = "todo_update";
pub(crate) const TODO_FINISH_MODEL_TOOL: &str = "todo_finish";

pub(crate) fn risk_identifier_mutates(risk: &str) -> bool {
    !risk.trim().eq_ignore_ascii_case("read")
}

mod artifact;
mod artifacts;
mod browser_adapter;
mod browser_concurrency;
mod browser_interact;
mod clarification_adapter;
pub(crate) mod codegraph;
mod codegraph_signals;
mod design_quality;
mod design_reference;
mod dispatcher;
mod file;
mod hardware;
mod host_executor;
mod mcp_adapter;
mod memory_adapter;
mod native_executor;
mod native_helpers;
mod page_snapshot;
mod permission_policy;
mod plan;
mod quality_gate;
mod search;
mod shell;
mod skill_adapter;
mod software_adapter;
mod streaming_diff_preview;
mod task_contract;
mod terminal;
mod timeouts;
mod todo;
pub(crate) mod tool_fs;
mod user_action;
mod web;
mod web_jobs;
mod workbench_adapter;

pub(crate) use self::{
    artifact::*, artifacts::*, browser_adapter::*, browser_concurrency::*, browser_interact::*,
    clarification_adapter::*, codegraph::*, codegraph_signals::*, design_quality::*,
    design_reference::*, dispatcher::*, file::*, hardware::*, host_executor::*, mcp_adapter::*,
    memory_adapter::*, native_executor::*, native_helpers::*, page_snapshot::*,
    permission_policy::*, plan::*, quality_gate::*, search::*, shell::*, skill_adapter::*,
    software_adapter::*, streaming_diff_preview::*, task_contract::*, terminal::*, timeouts::*,
    todo::*, user_action::*, web::*, web_jobs::*, workbench_adapter::*,
};

#[cfg(test)]
mod risk_identifier_tests {
    use super::risk_identifier_mutates;

    #[test]
    fn only_exact_read_is_non_mutating() {
        assert!(!risk_identifier_mutates("read"));
        assert!(!risk_identifier_mutates(" READ "));
        assert!(risk_identifier_mutates("readonly"));
        assert!(risk_identifier_mutates("metadata_read"));
        assert!(risk_identifier_mutates("unknown"));
    }
}
