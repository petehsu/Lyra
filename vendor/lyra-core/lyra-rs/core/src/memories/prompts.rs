use crate::memories::lyra_truth::load_memory_prompt_context;
use lyra_utils_absolute_path::AbsolutePathBuf;
use lyra_utils_output_truncation::TruncationPolicy;
use lyra_utils_output_truncation::truncate_text;
use lyra_utils_template::Template;
use std::sync::LazyLock;

static MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_TEMPLATE: LazyLock<Template> = LazyLock::new(|| {
    parse_embedded_template(
        include_str!("../../templates/memories/read_path.md"),
        "memories/read_path.md",
    )
});
const MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT: usize = 5_000;

fn parse_embedded_template(source: &'static str, template_name: &str) -> Template {
    match Template::parse(source) {
        Ok(template) => template,
        Err(err) => panic!("embedded template {template_name} is invalid: {err}"),
    }
}

/// Build prompt used for read path. This prompt is derived directly from Lyra
/// memory truth rather than Lyra legacy `memory_summary.md` artifacts.
pub(crate) async fn build_memory_tool_developer_instructions(
    lyra_home: &AbsolutePathBuf,
    thread_id: &str,
) -> Option<String> {
    let prompt_context = load_memory_prompt_context(lyra_home.as_ref(), thread_id).ok()??;
    let current_session_excerpt = truncate_text(
        &prompt_context.current_session_excerpt,
        TruncationPolicy::Tokens(MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT),
    );
    let shared_memory = truncate_text(
        &prompt_context.shared_memory,
        TruncationPolicy::Tokens(MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT),
    );
    let frozen_memory = truncate_text(
        &prompt_context.frozen_memory,
        TruncationPolicy::Tokens(MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT),
    );
    let dynamic_prompt_cache = truncate_text(
        &prompt_context.dynamic_prompt_cache,
        TruncationPolicy::Tokens(MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT),
    );
    if current_session_excerpt.is_empty()
        && shared_memory.is_empty()
        && frozen_memory.is_empty()
        && dynamic_prompt_cache.is_empty()
    {
        return None;
    }
    MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_TEMPLATE
        .render([
            ("lyra_truth_root", prompt_context.truth_root_path.as_str()),
            (
                "current_session_id",
                prompt_context.current_session_id.as_str(),
            ),
            (
                "current_session_sqlite_path",
                prompt_context.current_session_sqlite_path.as_str(),
            ),
            (
                "shared_truth_sqlite_path",
                prompt_context.shared_truth_sqlite_path.as_str(),
            ),
            (
                "frozen_truth_sqlite_path",
                prompt_context.frozen_truth_sqlite_path.as_str(),
            ),
            (
                "conflict_sets_sqlite_path",
                prompt_context.conflict_sets_sqlite_path.as_str(),
            ),
            (
                "shared_memory_path",
                prompt_context.shared_memory_path.as_str(),
            ),
            (
                "frozen_memory_path",
                prompt_context.frozen_memory_path.as_str(),
            ),
            (
                "dynamic_prompt_cache_path",
                prompt_context.dynamic_prompt_cache_path.as_str(),
            ),
            ("current_session_excerpt", current_session_excerpt.as_str()),
            ("shared_memory", shared_memory.as_str()),
            ("frozen_memory", frozen_memory.as_str()),
            ("dynamic_prompt_cache", dynamic_prompt_cache.as_str()),
        ])
        .ok()
}

#[cfg(test)]
#[path = "prompts_tests.rs"]
mod tests;
