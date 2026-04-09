use regex::Regex;
use std::sync::LazyLock;

use super::policy::CommandRiskLevel;

/// A single rule entry pairing a regex pattern with its risk classification.
struct RuleEntry {
    pattern: &'static str,
    risk: CommandRiskLevel,
    description: &'static str,
}

/// Built-in command classification rules.
///
/// Heavily inspired by:
/// - Claude Code's `dangerousPatterns.ts` (~70 patterns)
/// - Claude Code's `readOnlyValidation.ts` (~1500 lines of allowlist)
/// - Zed's `tool_permissions.rs` regex-based classification
///
/// Rules are evaluated in order — first match wins.
/// The default (no match) is MediumRisk.
static BUILTIN_RULES: LazyLock<Vec<RuleEntry>> = LazyLock::new(|| {
    vec![
        // ═══════════════════════════════════════════
        // CRITICAL — Always denied by default
        // ═══════════════════════════════════════════
        // System destruction
        RuleEntry {
            pattern: r"^rm\s+(-[rfR]*\s+)*(/|/\*|~|~\/|\$HOME|\$\{HOME\})",
            risk: CommandRiskLevel::Critical,
            description: "Recursive delete of root/home directory",
        },
        RuleEntry {
            pattern: r"rm\s+-rf\s+/",
            risk: CommandRiskLevel::Critical,
            description: "Force recursive delete of root",
        },
        RuleEntry {
            pattern: r"rm\s+-rf\s+\*",
            risk: CommandRiskLevel::Critical,
            description: "Force recursive delete of everything",
        },
        // Disk/filesystem destruction
        RuleEntry {
            pattern: r"^mkfs",
            risk: CommandRiskLevel::Critical,
            description: "Format filesystem",
        },
        RuleEntry {
            pattern: r"^dd\s+if=",
            risk: CommandRiskLevel::Critical,
            description: "Raw disk write",
        },
        RuleEntry {
            pattern: r">\s*/dev/sd",
            risk: CommandRiskLevel::Critical,
            description: "Redirect to block device",
        },
        // System power/state
        RuleEntry {
            pattern: r"^(shutdown|reboot|halt|poweroff)(\s|$)",
            risk: CommandRiskLevel::Critical,
            description: "System shutdown/reboot",
        },
        RuleEntry {
            pattern: r"^init\s+[06]",
            risk: CommandRiskLevel::Critical,
            description: "Change runlevel to halt/reboot",
        },
        // Fork bombs
        RuleEntry {
            pattern: r":\(\)\{",
            risk: CommandRiskLevel::Critical,
            description: "Fork bomb syntax",
        },
        RuleEntry {
            pattern: r"\{\s*:\|\s*&\s*\}\s*;",
            risk: CommandRiskLevel::Critical,
            description: "Fork bomb execution",
        },
        // Dangerous chmod
        RuleEntry {
            pattern: r"^chmod\s+-R\s+777\s+/",
            risk: CommandRiskLevel::Critical,
            description: "World-writable root filesystem",
        },
        // LD_PRELOAD injection
        RuleEntry {
            pattern: r"LD_PRELOAD=",
            risk: CommandRiskLevel::Critical,
            description: "Library preload injection",
        },
        RuleEntry {
            pattern: r"LD_LIBRARY_PATH=",
            risk: CommandRiskLevel::Critical,
            description: "Library path injection",
        },
        RuleEntry {
            pattern: r"DYLD_INSERT_LIBRARIES=",
            risk: CommandRiskLevel::Critical,
            description: "macOS library injection",
        },

        // ═══════════════════════════════════════════
        // HIGH RISK — Always requires explicit approval
        // ═══════════════════════════════════════════
        // Privilege escalation
        RuleEntry {
            pattern: r"^sudo(\s|$)",
            risk: CommandRiskLevel::HighRisk,
            description: "Privilege escalation via sudo",
        },
        RuleEntry {
            pattern: r"^su(\s|$)",
            risk: CommandRiskLevel::HighRisk,
            description: "Switch user",
        },
        // Network tools (potential exfiltration)
        RuleEntry {
            pattern: r"^(curl|wget)\s+.*\|\s*(bash|sh|zsh)",
            risk: CommandRiskLevel::HighRisk,
            description: "Pipe remote script to shell",
        },
        RuleEntry {
            pattern: r"^(curl|wget)\s+-",
            risk: CommandRiskLevel::HighRisk,
            description: "Download with curl/wget",
        },
        // SSH/remote access
        RuleEntry {
            pattern: r"^ssh(\s|$)",
            risk: CommandRiskLevel::HighRisk,
            description: "SSH connection",
        },
        // Process manipulation
        RuleEntry {
            pattern: r"^kill\s+-9",
            risk: CommandRiskLevel::HighRisk,
            description: "Force kill process",
        },
        RuleEntry {
            pattern: r"^killall(\s|$)",
            risk: CommandRiskLevel::HighRisk,
            description: "Kill all processes by name",
        },
        RuleEntry {
            pattern: r"^pkill(\s|$)",
            risk: CommandRiskLevel::HighRisk,
            description: "Signal processes by pattern",
        },
        // Dangerous interpreters with eval
        RuleEntry {
            pattern: r"^\w+\s+-[ce]\s+",
            risk: CommandRiskLevel::HighRisk,
            description: "Execute string via interpreter",
        },
        // Database access
        RuleEntry {
            pattern: r"^(mysql|psql|sqlite3)\s+",
            risk: CommandRiskLevel::HighRisk,
            description: "Database client execution",
        },
        // Cloud CLI
        RuleEntry {
            pattern: r"^(aws|gcloud|kubectl|terraform)\s+",
            risk: CommandRiskLevel::HighRisk,
            description: "Cloud/infrastructure CLI",
        },
        // Package managers (can modify system)
        RuleEntry {
            pattern: r"^(apt|apt-get|yum|dnf|pacman)\s+(install|remove|upgrade)",
            risk: CommandRiskLevel::HighRisk,
            description: "System package manager modification",
        },
        // Docker commands
        RuleEntry {
            pattern: r"^docker\s+(rm|rmi|system\s+prune|volume\s+prune)",
            risk: CommandRiskLevel::HighRisk,
            description: "Docker destructive operation",
        },

        // ═══════════════════════════════════════════
        // MEDIUM RISK — May need approval depending on mode
        // ═══════════════════════════════════════════
        // Interpreters (can do anything)
        RuleEntry {
            pattern: r"^(python|python3|node|ruby|perl|php)\s+",
            risk: CommandRiskLevel::MediumRisk,
            description: "Script interpreter execution",
        },
        // Package runners
        RuleEntry {
            pattern: r"^(npm|yarn|pnpm)\s+(run|exec|install|i|add)",
            risk: CommandRiskLevel::MediumRisk,
            description: "Package manager execution",
        },
        // Git write operations
        RuleEntry {
            pattern: r"^git\s+(push|commit|reset|rebase|merge|amend)",
            risk: CommandRiskLevel::MediumRisk,
            description: "Git write operation",
        },
        // File permission changes
        RuleEntry {
            pattern: r"^chmod\s+",
            risk: CommandRiskLevel::MediumRisk,
            description: "Change file permissions",
        },
        RuleEntry {
            pattern: r"^chown\s+",
            risk: CommandRiskLevel::MediumRisk,
            description: "Change file ownership",
        },
        // Archive extraction (can overwrite files)
        RuleEntry {
            pattern: r"^tar\s+.*-[xf]",
            risk: CommandRiskLevel::MediumRisk,
            description: "Archive extraction",
        },
        // Build commands
        RuleEntry {
            pattern: r"^(make|cmake|cargo\s+build|cargo\s+test)\s*",
            risk: CommandRiskLevel::MediumRisk,
            description: "Build/test execution",
        },
        // npm/pip install (local)
        RuleEntry {
            pattern: r"^(pip|pip3|pipx)\s+(install|uninstall)",
            risk: CommandRiskLevel::MediumRisk,
            description: "Python package installation",
        },

        // ═══════════════════════════════════════════
        // LOW RISK — Minor write operations
        // ═══════════════════════════════════════════
        // File creation
        RuleEntry {
            pattern: r"^touch\s+",
            risk: CommandRiskLevel::LowRisk,
            description: "Create empty file",
        },
        RuleEntry {
            pattern: r"^mkdir\s+",
            risk: CommandRiskLevel::LowRisk,
            description: "Create directory",
        },
        // Append redirect
        RuleEntry {
            pattern: r">>\s+",
            risk: CommandRiskLevel::LowRisk,
            description: "Append to file",
        },
        // Echo to file
        RuleEntry {
            pattern: r"^echo\s+.*>\s+",
            risk: CommandRiskLevel::LowRisk,
            description: "Write to file via echo",
        },
        // Copy/move
        RuleEntry {
            pattern: r"^(cp|mv|rsync)\s+",
            risk: CommandRiskLevel::LowRisk,
            description: "Copy or move files",
        },
        // Link creation
        RuleEntry {
            pattern: r"^ln\s+",
            risk: CommandRiskLevel::LowRisk,
            description: "Create link",
        },

        // ═══════════════════════════════════════════
        // SAFE — Read-only operations, auto-approved
        // ═══════════════════════════════════════════
        // File listing/reading
        RuleEntry {
            pattern: r"^(ls|dir)\s*",
            risk: CommandRiskLevel::Safe,
            description: "List directory",
        },
        RuleEntry {
            pattern: r"^(cat|head|tail|less|more|nl|wc)\s+",
            risk: CommandRiskLevel::Safe,
            description: "Read file contents",
        },
        RuleEntry {
            pattern: r"^find\s+",
            risk: CommandRiskLevel::Safe,
            description: "Find files",
        },
        RuleEntry {
            pattern: r"^(du|df)\s*",
            risk: CommandRiskLevel::Safe,
            description: "Disk usage info",
        },
        // Text processing
        RuleEntry {
            pattern: r"^(grep|egrep|fgrep|awk|sed\s+-n)\s+",
            risk: CommandRiskLevel::Safe,
            description: "Text search/processing",
        },
        // Git read operations
        RuleEntry {
            pattern: r"^git\s+(status|log|diff|show|branch|tag|remote\s+-v)\s*",
            risk: CommandRiskLevel::Safe,
            description: "Git read operation",
        },
        // System info
        RuleEntry {
            pattern: r"^(uname|whoami|id|pwd|date|uptime|free|top\s+-bn1)\s*",
            risk: CommandRiskLevel::Safe,
            description: "System information",
        },
        // Network read
        RuleEntry {
            pattern: r"^(ping|nslookup|dig|host)\s+",
            risk: CommandRiskLevel::Safe,
            description: "Network diagnostics (read)",
        },
        // Process listing
        RuleEntry {
            pattern: r"^ps\s+",
            risk: CommandRiskLevel::Safe,
            description: "List processes",
        },
        // Which/whereis
        RuleEntry {
            pattern: r"^(which|whereis|type|command\s+-v)\s+",
            risk: CommandRiskLevel::Safe,
            description: "Command location lookup",
        },
        // Tree
        RuleEntry {
            pattern: r"^tree\s*",
            risk: CommandRiskLevel::Safe,
            description: "Directory tree",
        },
        // md5sum/sha256sum
        RuleEntry {
            pattern: r"^(md5sum|sha1sum|sha256sum|shasum)\s+",
            risk: CommandRiskLevel::Safe,
            description: "Checksum calculation",
        },
        // Cargo read
        RuleEntry {
            pattern: r"^cargo\s+(check|doc|metadata|search)\s*",
            risk: CommandRiskLevel::Safe,
            description: "Cargo read operation",
        },
        // npm read
        RuleEntry {
            pattern: r"^(npm|yarn|pnpm)\s+(list|info|view|outdated)\s*",
            risk: CommandRiskLevel::Safe,
            description: "Package manager info",
        },
    ]
});

/// Compiles all builtin rule patterns into Regex objects.
/// Called once at startup.
pub fn compiled_rules() -> Vec<(Regex, CommandRiskLevel, &'static str)> {
    BUILTIN_RULES
        .iter()
        .filter_map(|rule| {
            match Regex::new(rule.pattern) {
                Ok(re) => Some((re, rule.risk, rule.description)),
                Err(e) => {
                    eprintln!("[lyra-sandbox] Failed to compile rule '{}': {}", rule.pattern, e);
                    None
                }
            }
        })
        .collect()
}

/// Evaluate a command against the builtin rules.
/// Returns the first matching rule's risk level, or MediumRisk as default.
pub fn evaluate_builtin(command: &str) -> (CommandRiskLevel, Option<&'static str>) {
    let rules = compiled_rules();

    for (re, risk, desc) in &rules {
        if re.is_match(command) {
            return (*risk, Some(*desc));
        }
    }

    // Default: unknown commands are medium risk
    (CommandRiskLevel::MediumRisk, None)
}

/// Check if a command is purely read-only (no filesystem modifications).
///
/// Inspired by Claude Code's readOnlyValidation.ts — validates that every
/// sub-command in a compound command (&&, ||, ;) is read-only.
pub fn is_read_only_command(command: &str) -> bool {
    // Split compound commands
    let subcommands: Vec<&str> = command
        .split(&[';', '|', '&'][..])
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim())
        .collect();

    subcommands.iter().all(|cmd| is_single_read_only(cmd))
}

fn is_single_read_only(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return true;
    }

    // Check for write indicators
    let write_patterns = [
        ">", ">>", "| tee", "| dd", "mkfs", "chmod", "chown", "mkdir", "touch",
        "rm ", "mv ", "cp ", "rsync", "ln ", "sudo", "kill", "pkill", "killall",
    ];

    for pattern in &write_patterns {
        if trimmed.contains(pattern) {
            return false;
        }
    }

    // Check against builtin safe rules
    let (risk, _) = evaluate_builtin(trimmed);
    matches!(risk, CommandRiskLevel::Safe)
}
