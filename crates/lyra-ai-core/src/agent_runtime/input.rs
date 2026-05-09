use super::*;

pub(super) fn input_parts(input: &RuntimeTurnInput) -> Vec<AgentMessageContentPart> {
    if !input.parts.is_empty() {
        return input
            .parts
            .iter()
            .map(|part| match part {
                RuntimeTurnInputPart::Text { text } => AgentMessageContentPart {
                    r#type: "text".to_string(),
                    text: Some(text.clone()),
                    name: None,
                    path: None,
                    kind: None,
                },
                RuntimeTurnInputPart::Attachment { attachment } => part_from_attachment(attachment),
            })
            .collect();
    }
    input.attachments.iter().map(part_from_attachment).collect()
}

fn part_from_attachment(attachment: &RuntimeTurnAttachment) -> AgentMessageContentPart {
    AgentMessageContentPart {
        r#type: "attachment".to_string(),
        text: attachment.context_text.clone(),
        name: Some(attachment.name.clone()),
        path: Some(attachment.path.clone()),
        kind: Some(attachment.kind.clone()),
    }
}

pub(super) fn normalize_collaboration_mode(value: Option<&str>) -> String {
    if value.and_then(trim_to_string).as_deref() == Some("plan") {
        "plan".to_string()
    } else {
        "default".to_string()
    }
}

pub(super) fn title_from_text(text: &str) -> Option<String> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    let mut title = normalized.chars().take(48).collect::<String>();
    if normalized.chars().count() > 48 {
        title.push_str("...");
    }
    Some(title)
}

pub(super) fn title_after_message(current: &str, text: &str) -> String {
    if current == "New thread" {
        title_from_text(text).unwrap_or_else(|| current.to_string())
    } else {
        current.to_string()
    }
}

pub(super) fn mini_todo_items_for_request(text: &str) -> Option<Vec<CreateTodoItemInput>> {
    if is_execution_request(text) == false {
        return None;
    }
    Some(vec![
        CreateTodoItemInput {
            title: "Inspect relevant context".to_string(),
            actions: vec!["Read or search the workspace context needed for the change".to_string()],
            expected_tools: vec![
                TOOL_FS_LIST_FILES.to_string(),
                TOOL_FS_READ_FILE.to_string(),
                TOOL_FS_SEARCH_TEXT.to_string(),
            ],
            risk_level: "low".to_string(),
            completion_criteria: vec!["Relevant workspace evidence has been collected".to_string()],
            source: json!({ "type": "mini_auto", "slot": "inspect_context" }),
        },
        CreateTodoItemInput {
            title: "Prepare workspace changes".to_string(),
            actions: vec![
                "Produce a patch proposal for the requested workspace change".to_string(),
            ],
            expected_tools: vec![TOOL_FS_PROPOSE_PATCH.to_string()],
            risk_level: "medium".to_string(),
            completion_criteria: vec!["A patch proposal artifact is available".to_string()],
            source: json!({ "type": "mini_auto", "slot": "prepare_patch" }),
        },
        CreateTodoItemInput {
            title: "Apply approved workspace changes".to_string(),
            actions: vec!["Apply or roll back the approved patch through ToolFS".to_string()],
            expected_tools: vec![
                TOOL_FS_APPLY_PATCH.to_string(),
                TOOL_FS_ROLLBACK_PATCH.to_string(),
            ],
            risk_level: "medium".to_string(),
            completion_criteria: vec![
                "Workspace write action is completed or explicitly blocked".to_string()
            ],
            source: json!({ "type": "mini_auto", "slot": "workspace_write" }),
        },
        CreateTodoItemInput {
            title: "Record verification status".to_string(),
            actions: vec!["Capture what was or was not verified for this execution".to_string()],
            expected_tools: vec![TOOL_SHELL_RUN_COMMAND.to_string()],
            risk_level: "low".to_string(),
            completion_criteria: vec![
                "Verification status is reflected in the final response".to_string()
            ],
            source: json!({ "type": "mini_auto", "slot": "verification_note" }),
        },
    ])
}

fn is_execution_request(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() {
        return false;
    }
    let greeting_markers = ["hi", "hello", "hey", "你好", "早上好", "晚上好"];
    if greeting_markers
        .iter()
        .any(|marker| normalized == *marker || normalized.starts_with(&format!("{marker} ")))
    {
        return false;
    }
    let inspection_markers = [
        "详细看一下",
        "看一下这些",
        "分析这些",
        "梳理一下",
        "了解这些",
        "读一下这些",
        "具体是什么",
        "look through these",
        "inspect these",
        "analyze these",
        "summarize these",
        "read through these",
    ];
    let workspace_object_markers = [
        "文档",
        "文件",
        "项目",
        "代码",
        "docs",
        "documents",
        "files",
        "repo",
        "codebase",
        "workspace",
    ];
    if inspection_markers
        .iter()
        .any(|marker| normalized.contains(marker))
        && workspace_object_markers
            .iter()
            .any(|marker| normalized.contains(marker))
    {
        return true;
    }
    let question_markers = [
        "what is",
        "why",
        "how do",
        "explain",
        "tell me",
        "介绍",
        "解释",
        "为什么",
        "是什么",
        "怎么",
    ];
    if normalized.chars().count() < 24
        && question_markers
            .iter()
            .any(|marker| normalized.contains(marker))
    {
        return false;
    }
    let execution_markers = [
        "implement",
        "fix",
        "refactor",
        "add ",
        "update",
        "build",
        "apply patch",
        "rollback",
        "make change",
        "做完",
        "实现",
        "修复",
        "重构",
        "添加",
        "新增",
        "更新",
        "先做",
        "执行",
        "改",
        "补",
    ];
    execution_markers
        .iter()
        .any(|marker| normalized.contains(marker))
}
