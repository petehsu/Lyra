use super::*;

const AUTH_QUESTION_MARKER: &str = "authentication";
const AUTH_CHALLENGE_SIGNAL_MARKER: &str = "AuthChallengeSignal";

fn text_mentions_authentication(text: &str) -> bool {
    text.to_ascii_lowercase().contains(AUTH_QUESTION_MARKER)
}

fn text_has_auth_challenge_signal(text: &str) -> bool {
    text.contains(AUTH_CHALLENGE_SIGNAL_MARKER)
}

pub(crate) fn is_legacy_auth_clarification(request: &ClarificationRequest) -> bool {
    request.i18n_key.is_none()
        && (text_mentions_authentication(&request.question)
            || request
                .detail
                .as_deref()
                .is_some_and(text_has_auth_challenge_signal)
            || request.options.iter().any(|option| {
                option.get("label").and_then(Value::as_str) == Some("Already Completed")
            }))
}

pub(crate) fn fail_legacy_auth_tools(
    session: &mut NativeSession,
    legacy_auth_tools: &HashSet<(String, String)>,
) -> bool {
    let session_id = session.id.clone();
    let Some(tools) = session
        .snapshot
        .get_mut("tools")
        .and_then(Value::as_array_mut)
    else {
        return false;
    };
    let mut changed = false;
    for tool in tools {
        let Some(tool_id) = tool.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !legacy_auth_tools.contains(&(session_id.clone(), tool_id.to_string()))
            || !matches!(
                tool.get("status").and_then(Value::as_str),
                Some("running" | "suspended_user_action")
            )
        {
            continue;
        }
        tool["status"] = Value::String("failed".to_string());
        tool["finishedAt"] = Value::String(now());
        tool["output"] = json!({
            "code": "AUTH_CLARIFICATION_MIGRATED",
            "retryable": true,
            "content": "A legacy authentication pause was cleared. Retry the tool to use the standard OAuth flow."
        });
        changed = true;
    }
    changed
}
