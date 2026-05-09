use serde_json::Value;

pub fn hardcoded_deny_reason(tool_name: &str, arguments: &Value) -> Option<String> {
    match tool_name {
        "terminal" => terminal_hardcoded_deny(arguments),
        "delete_path" => delete_path_hardcoded_deny(arguments),
        _ => None,
    }
}

fn terminal_hardcoded_deny(arguments: &Value) -> Option<String> {
    for command in terminal_command_segments(arguments) {
        let normalized = normalize_command(&command);
        if destructive_rm_target(&normalized) {
            return Some("refusing destructive rm target".to_string());
        }
        if normalized.starts_with("git reset --hard") {
            return Some("refusing git reset --hard".to_string());
        }
        if normalized.starts_with("git clean -fd") || normalized.starts_with("git clean -xdf") {
            return Some("refusing destructive git clean".to_string());
        }
        if normalized.starts_with("sudo ") {
            return Some("refusing sudo command".to_string());
        }
    }
    None
}

fn delete_path_hardcoded_deny(arguments: &Value) -> Option<String> {
    let path = arguments
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if matches!(path, "" | "." | "/" | "~") || path.ends_with("/..") {
        Some("refusing delete_path target outside a concrete workspace path".to_string())
    } else {
        None
    }
}

fn terminal_command_segments(arguments: &Value) -> Vec<String> {
    if let Some(argv) = arguments.get("argv").and_then(Value::as_array) {
        let command = argv
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ");
        return vec![command];
    }
    arguments
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("")
        .split([';', '|', '&'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn normalize_command(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn destructive_rm_target(command: &str) -> bool {
    if !command.starts_with("rm ") || !(command.contains(" -rf") || command.contains(" -fr")) {
        return false;
    }
    command
        .split_whitespace()
        .skip(1)
        .filter(|part| !part.starts_with('-'))
        .any(|target| matches!(target, "/" | "." | ".." | "~" | "$HOME" | "*"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_known_destructive_terminal_commands() {
        assert!(terminal_hardcoded_deny(&json!({ "argv": ["rm", "-rf", "/"] })).is_some());
        assert!(terminal_hardcoded_deny(&json!({ "command": "git reset --hard" })).is_some());
        assert!(terminal_hardcoded_deny(&json!({ "command": "echo ok" })).is_none());
    }

    #[test]
    fn rejects_ambiguous_delete_targets() {
        assert!(delete_path_hardcoded_deny(&json!({ "path": "." })).is_some());
        assert!(delete_path_hardcoded_deny(&json!({ "path": "src/tmp.txt" })).is_none());
    }
}
