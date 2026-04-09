use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Decision made by the user for a specific command pattern.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionDecision {
    /// Allow this command once (not persisted).
    AllowOnce,
    /// Always allow this command pattern (persisted).
    AllowAlways,
    /// Always deny this command pattern (persisted).
    DenyAlways,
}

/// A single permission rule mapping a command pattern to a decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRule {
    /// The command pattern (e.g., "ls:*", "git status", "npm run build").
    pub pattern: String,
    /// The user's decision for this pattern.
    pub decision: PermissionDecision,
    /// Optional human-readable description.
    pub description: Option<String>,
}

/// Persistent permissions store.
///
/// Mirrors Claude Code's settings hierarchy with project-level and global-level configs.
/// Stored as `.lyra/permissions.json` in the project root.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PermissionsStore {
    /// Rules that are always allowed (auto-approved).
    #[serde(default)]
    pub allow: Vec<PermissionRule>,
    /// Rules that are always denied.
    #[serde(default)]
    pub deny: Vec<PermissionRule>,
    /// Rules that always require explicit user confirmation.
    #[serde(default)]
    pub ask: Vec<PermissionRule>,
    /// Default behavior for unmatched commands.
    #[serde(default = "default_permission_mode")]
    pub default_mode: String,
}

fn default_permission_mode() -> String {
    "ask".to_string()
}

impl PermissionsStore {
    /// Load permissions from a project's `.lyra/permissions.json` file.
    /// Falls back to an empty store if the file doesn't exist.
    pub fn load(project_root: &str) -> Self {
        let path = permissions_path(project_root);
        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(store) => store,
                Err(e) => {
                    eprintln!("[lyra-sandbox] Failed to parse permissions at {:?}: {}", path, e);
                    Self::default()
                }
            },
            Err(_) => Self::default(),
        }
    }

    /// Save permissions to the project's `.lyra/permissions.json` file.
    pub fn save(&self, project_root: &str) -> std::io::Result<()> {
        let path = permissions_path(project_root);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        fs::write(&path, content)
    }

    /// Check if a command matches an always-allow rule.
    /// Uses simple pattern matching: `*` matches any suffix.
    pub fn is_allowed(&self, command: &str) -> bool {
        self.allow.iter().any(|rule| pattern_matches(&rule.pattern, command))
    }

    /// Check if a command matches an always-deny rule.
    pub fn is_denied(&self, command: &str) -> bool {
        self.deny.iter().any(|rule| pattern_matches(&rule.pattern, command))
    }

    /// Check if a command matches an always-ask rule.
    pub fn requires_ask(&self, command: &str) -> bool {
        self.ask.iter().any(|rule| pattern_matches(&rule.pattern, command))
    }

    /// Add a rule and persist it.
    pub fn add_rule(&mut self, project_root: &str, pattern: &str, decision: PermissionDecision) -> std::io::Result<()> {
        let rule = PermissionRule {
            pattern: pattern.to_string(),
            decision: decision.clone(),
            description: None,
        };

        match decision {
            PermissionDecision::AllowAlways => self.allow.push(rule),
            PermissionDecision::DenyAlways => self.deny.push(rule),
            PermissionDecision::AllowOnce => {
                // AllowOnce is not persisted — it's a one-time decision
            }
        }

        // Only persist if it's a permanent decision
        if matches!(decision, PermissionDecision::AllowAlways | PermissionDecision::DenyAlways) {
            self.save(project_root)?;
        }

        Ok(())
    }

    /// Remove a rule by pattern and persist.
    pub fn remove_rule(&mut self, project_root: &str, pattern: &str) -> std::io::Result<()> {
        self.allow.retain(|r| r.pattern != pattern);
        self.deny.retain(|r| r.pattern != pattern);
        self.ask.retain(|r| r.pattern != pattern);
        self.save(project_root)
    }

    /// Resolve the effective decision for a command.
    /// Returns the matching decision, or the default mode if no rule matches.
    pub fn resolve(&self, command: &str) -> PermissionDecision {
        // Deny rules take highest priority
        if self.is_denied(command) {
            return PermissionDecision::DenyAlways;
        }
        // Then allow rules
        if self.is_allowed(command) {
            return PermissionDecision::AllowAlways;
        }
        // Then ask rules
        if self.requires_ask(command) {
            return PermissionDecision::AllowOnce; // ask = needs one-time approval
        }
        // Default mode
        match self.default_mode.as_str() {
            "allow" => PermissionDecision::AllowAlways,
            "deny" => PermissionDecision::DenyAlways,
            _ => PermissionDecision::AllowOnce, // default: ask
        }
    }
}

/// Build the path to the permissions file for a project.
fn permissions_path(project_root: &str) -> PathBuf {
    Path::new(project_root).join(".lyra").join("permissions.json")
}

/// Simple pattern matching supporting `*` wildcard.
///
/// Supports patterns like:
/// - `"ls:*"` → matches any command starting with `ls:`
/// - `"git status"` → exact match
/// - `"npm run *"` → matches `npm run build`, `npm run test`, etc.
fn pattern_matches(pattern: &str, command: &str) -> bool {
    if pattern.is_empty() {
        return false;
    }

    // Exact match (no wildcards)
    if !pattern.contains('*') {
        return pattern == command || command.starts_with(&format!("{} ", pattern));
    }

    // Wildcard matching
    if pattern.ends_with(":*") {
        // Prefix match: "ls:*" matches "ls:anything"
        let prefix = &pattern[..pattern.len() - 2];
        return command.starts_with(prefix);
    }

    if pattern.ends_with('*') {
        // Suffix wildcard: "npm run *" matches "npm run build"
        let prefix = &pattern[..pattern.len() - 1].trim_end();
        return command.starts_with(prefix);
    }

    // For other patterns with *, do a simple contains check
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 2 {
        return command.starts_with(parts[0]) && command.ends_with(parts[1]);
    }

    false
}

/// Global permissions store (user-level, not project-specific).
/// Stored at `~/.lyra/permissions.json`.
pub fn load_global_permissions() -> PermissionsStore {
    let home = dirs::home_dir().unwrap_or_default();
    let global_path = home.join(".lyra").join("permissions.json");
    match fs::read_to_string(&global_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => PermissionsStore::default(),
    }
}

/// Merge project-level and global-level permissions.
/// Project-level rules take precedence over global rules.
pub fn merge_permissions(project: &PermissionsStore, global: &PermissionsStore) -> PermissionsStore {
    let mut merged = global.clone();
    // Project rules override global rules
    merged.allow.extend(project.allow.iter().cloned());
    merged.deny.extend(project.deny.iter().cloned());
    merged.ask.extend(project.ask.iter().cloned());
    merged.default_mode.clone_from(&project.default_mode);
    merged
}
