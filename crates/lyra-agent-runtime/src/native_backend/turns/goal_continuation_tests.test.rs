#![cfg(test)]

use super::*;

#[test]
fn prompt_with_incomplete_todos_only() {
    let todos = vec![
        json!({ "id": "todo-1", "status": "in_progress", "content": "实现核心逻辑" }),
        json!({ "id": "todo-2", "status": "pending", "content": "编写测试" }),
    ];
    let refs: Vec<&Value> = todos.iter().collect();
    let prompt = build_continuation_prompt(&refs, false);

    assert!(prompt.contains("[Goal Continuation]"));
    assert!(prompt.contains("未完成 todo（2 个）"));
    assert!(prompt.contains("[todo-1] [in_progress] 实现核心逻辑"));
    assert!(prompt.contains("[todo-2] [pending] 编写测试"));
    assert!(prompt.contains("请继续推进未完成的工作。"));
}

#[test]
fn prompt_requests_todo_finish_when_all_items_are_terminal() {
    let prompt = build_continuation_prompt(&[], true);

    assert!(prompt.contains("[Goal Continuation]"));
    assert!(!prompt.contains("未完成 todo"));
    assert!(prompt.contains("请调用 todo_finish"));
}

#[test]
fn no_progress_pauses_after_two_unchanged_turns() {
    let mut session = new_session(None, None, "normal");
    assert!(update_goal_progress_state(&mut session, "same"));
    assert!(update_goal_progress_state(&mut session, "same"));
    assert!(!update_goal_progress_state(&mut session, "same"));
    assert_eq!(
        session
            .snapshot
            .pointer("/goalContinuation/reason")
            .and_then(Value::as_str),
        Some("no_progress")
    );
}

#[test]
fn real_progress_resets_the_stagnant_counter() {
    let mut session = new_session(None, None, "normal");
    assert!(update_goal_progress_state(&mut session, "first"));
    assert!(update_goal_progress_state(&mut session, "first"));
    assert!(update_goal_progress_state(&mut session, "changed"));
    assert_eq!(
        session
            .snapshot
            .pointer("/goalContinuation/stagnantTurns")
            .and_then(Value::as_u64),
        Some(0)
    );
}

#[test]
fn prune_removes_only_goal_continuation_user_messages() {
    let mut snapshot = json!({
        "messages": [
            {
                "role": "user",
                "text": "用户原始消息",
                "id": "msg-1"
            },
            {
                "role": "user",
                "text": "[Goal Continuation] ...",
                "id": "msg-2",
                "metadata": { "uiHidden": true, "goalContinuation": true }
            },
            {
                "role": "assistant",
                "text": "我来继续工作。",
                "id": "msg-3"
            },
            {
                "role": "user",
                "text": "另一个普通 uiHidden 消息",
                "id": "msg-4",
                "metadata": { "uiHidden": true }
            }
        ]
    });

    prune_goal_continuation_messages(&mut snapshot);

    let messages = snapshot["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0]["id"], "msg-1");
    assert_eq!(messages[1]["id"], "msg-3");
    assert_eq!(messages[2]["id"], "msg-4");
}

#[test]
fn prune_preserves_messages_without_metadata() {
    let mut snapshot = json!({
        "messages": [
            { "role": "user", "text": "hello", "id": "a" },
            { "role": "assistant", "text": "hi", "id": "b" }
        ]
    });

    prune_goal_continuation_messages(&mut snapshot);

    let messages = snapshot["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2);
}
