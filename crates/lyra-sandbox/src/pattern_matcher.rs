use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

/// Cached compiled regexes for pattern matching.
///
/// Mirrors Zed's CompiledRegex approach — patterns are compiled once
/// and cached for fast repeated matching.
#[allow(dead_code)]
static COMPILED_PATTERNS: LazyLock<HashMap<&'static str, Regex>> = LazyLock::new(|| {
    let patterns = [
        // Output redirection detection
        (r">\s*/", Regex::new(r">\s*/").unwrap()),
        (r">\s*~", Regex::new(r">\s*~").unwrap()),
        (r">\s*\$HOME", Regex::new(r">\s*\$HOME").unwrap()),
        // Pipe to shell
        (r"\|\s*(ba)?sh", Regex::new(r"\|\s*(ba)?sh").unwrap()),
        (r"\|\s*zsh", Regex::new(r"\|\s*zsh").unwrap()),
        (r"\|\s*fish", Regex::new(r"\|\s*fish").unwrap()),
        // Subshell execution
        (r"\$\(", Regex::new(r"\$\(").unwrap()),
        (r"`[^`]+`", Regex::new(r"`[^`]+`").unwrap()),
        // Command chaining
        (r";\s*\w+", Regex::new(r";\s*\w+").unwrap()),
        (r"&&\s*\w+", Regex::new(r"&&\s*\w+").unwrap()),
        // Eval/exec patterns
        (r"\beval\b", Regex::new(r"\beval\b").unwrap()),
        (r"\bexec\b", Regex::new(r"\bexec\b").unwrap()),
        // Base64 encoded commands
        (r"base64\s+(-d|--decode)", Regex::new(r"base64\s+(-d|--decode)").unwrap()),
        // Heredoc (using r#...# to allow quotes in raw string)
        (r#"<<\s*['"]?\w+"#, Regex::new(r#"<<\s*['"]?\w+"#).unwrap()),
        // Process substitution
        (r"<\(", Regex::new(r"<\(").unwrap()),
    ];
    // Fix: collect properly
    let mut map = HashMap::new();
    for (name, re) in patterns {
        map.insert(name, re);
    }
    map
});

/// Match a command against a custom regex pattern.
/// Returns true if the pattern matches the command.
pub fn matches_pattern(command: &str, pattern: &str) -> bool {
    match Regex::new(pattern) {
        Ok(re) => re.is_match(command),
        Err(_) => false,
    }
}

/// Check if a command contains output redirection to sensitive paths.
pub fn has_sensitive_redirection(command: &str) -> bool {
    command.contains("> /")
        || command.contains(">~")
        || command.contains("> $HOME")
        || command.contains("> /dev/")
        || command.contains("> /etc/")
}

/// Check if a command pipes output to a shell interpreter.
pub fn pipes_to_shell(command: &str) -> bool {
    let pipe_to_shell = Regex::new(r"\|\s*(ba)?sh").unwrap();
    pipe_to_shell.is_match(command)
}

/// Extract the base command (first word) from a command string.
pub fn extract_base_command(command: &str) -> &str {
    command.split_whitespace().next().unwrap_or("")
}

/// Check if a command uses subshell or command substitution.
pub fn has_subshell(command: &str) -> bool {
    command.contains("$(") || {
        // Check for backtick substitution (must have even number of backticks)
        let count = command.chars().filter(|&c| c == '`').count();
        count >= 2 && count % 2 == 0
    }
}

/// Detect if a command chains multiple commands together.
pub fn has_command_chaining(command: &str) -> bool {
    // Count semicolons and &&/|| that are not inside quotes
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;

    for ch in command.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '\'' if !in_double_quote => in_single_quote = !in_single_quote,
            '"' if !in_single_quote => in_double_quote = !in_double_quote,
            ';' | '&' | '|' if !in_single_quote && !in_double_quote => return true,
            _ => {}
        }
    }
    false
}
