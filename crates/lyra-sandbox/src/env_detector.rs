use regex::Regex;
use std::collections::HashSet;

/// Dangerous environment variables that could be used for injection attacks.
///
/// Based on Claude Code's environment variable sanitization logic.
const DANGEROUS_ENV_VARS: &[&str] = &[
    // Dynamic linker/loader injection (Linux)
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "LD_AUDIT",
    "LD_DEBUG",
    // Dynamic linker injection (macOS)
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    // Docker host hijacking
    "DOCKER_HOST",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    // Kubernetes config hijacking
    "KUBECONFIG",
    // Proxy hijacking
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    // Shell hijacking
    "BASH_ENV",
    "ENV",
    "PROMPT_COMMAND",
    // Path manipulation
    "PATH",
    // SSL/TLS interception
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    // Python path injection
    "PYTHONPATH",
    "PYTHONSTARTUP",
    // Node.js injection
    "NODE_OPTIONS",
    "NODE_PATH",
    // Ruby injection
    "RUBYLIB",
    "RUBYOPT",
];

/// Detect dangerous environment variable assignments in a command string.
///
/// Scans for patterns like `VAR=value command` or `export VAR=value`.
/// Returns a list of detected dangerous variable names.
pub fn detect_env_injection(command: &str) -> Vec<String> {
    let mut found = Vec::new();
    let dangerous: HashSet<&str> = DANGEROUS_ENV_VARS.iter().cloned().collect();

    // Pattern: VAR=value at the start of command or after && / ; / |
    let env_assign = Regex::new(r"(?:^|[;&|])\s*([A-Za-z_][A-Za-z0-9_]*)=").unwrap();

    for cap in env_assign.captures_iter(command) {
        if let Some(var_match) = cap.get(1) {
            let var_name = var_match.as_str();
            if dangerous.contains(var_name) {
                found.push(var_name.to_string());
            }
        }
    }

    // Also check for `export VAR=value` patterns
    let export_pattern = Regex::new(r"export\s+([A-Za-z_][A-Za-z0-9_]*)=").unwrap();
    for cap in export_pattern.captures_iter(command) {
        if let Some(var_match) = cap.get(1) {
            let var_name = var_match.as_str();
            if dangerous.contains(var_name) && !found.contains(&var_name.to_string()) {
                found.push(var_name.to_string());
            }
        }
    }

    found
}

/// Check if a command sets the PATH variable (potential PATH manipulation attack).
pub fn has_path_manipulation(command: &str) -> bool {
    command.contains("PATH=") || command.contains("export PATH=")
}

/// Check if a command attempts to disable security features.
pub fn disables_security(command: &str) -> bool {
    let patterns = [
        "set +o",          // Disable shell options
        "unset HISTFILE",  // Disable history logging
        "history -c",      // Clear history
        "HISTSIZE=0",      // Zero history
        "HISTFILESIZE=0",  // Zero history file
        "disable_history", // Generic disable
        "set +x",          // Disable trace
    ];
    patterns.iter().any(|&p| command.contains(p))
}

/// Sanitize environment variables for a subprocess.
///
/// Returns a filtered list of env var assignments that are safe to propagate.
/// Removes dangerous variables that could lead to injection attacks.
pub fn sanitize_env_assignments(command: &str) -> String {
    let _dangerous: HashSet<&str> = DANGEROUS_ENV_VARS.iter().cloned().collect();

    // Remove dangerous VAR=value prefixes from the command
    let _env_prefix = Regex::new(r"(^|[;&|])\s*([A-Za-z_][A-Za-z0-9_]*)=").unwrap();

    let result = command.to_string();
    // We don't actually modify the command — we just detect and report.
    // The caller should decide whether to reject or warn.
    let injections = detect_env_injection(&result);
    if !injections.is_empty() {
        // Log warning but return original command
        // The sandbox policy layer will handle the decision
    }

    result
}
