//! Internalized jcode core source and Lyra GUI bridge.
//!
//! The files under `vendor/` are copied from jcode and kept in this crate so
//! Lyra can run as a GUI jcode client without depending on an external checkout.
//! Runtime-facing Lyra code should adapt through this module instead of growing
//! a separate hand-written Agent core.

pub mod bridge;

pub const VENDORED_UPSTREAM: &str = "src/jcode_core/vendor/upstream";
pub const VENDORED_ROOT_SRC: &str = "src/jcode_core/vendor/root_src";
pub const VENDORED_CRATES: &str = "src/jcode_core/vendor/crates";
pub const VENDORED_MANIFEST: &str = "src/jcode_core/vendor/UPSTREAM_MANIFEST.sha256";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VendoredJcodeCoreInventory {
    pub root_rust_files: usize,
    pub crate_rust_files: usize,
    pub total_rust_files: usize,
}

pub const VENDORED_INVENTORY: VendoredJcodeCoreInventory = VendoredJcodeCoreInventory {
    root_rust_files: 626,
    crate_rust_files: 134,
    total_rust_files: 760,
};

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn crate_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn vendored_jcode_core_is_present_with_tui_and_all_crates() {
        let root = crate_root().join("src/jcode_core/vendor");
        assert!(root.join("upstream/Cargo.toml").exists());
        assert!(root.join("upstream/src/tui/app.rs").exists());
        assert!(root.join("root_src/agent/turn_execution.rs").exists());
        assert!(root.join("root_src/provider/openai.rs").exists());
        assert!(root.join("root_src/tool/bash.rs").exists());
        assert!(root.join("root_src/session/persistence.rs").exists());
        assert!(root.join("root_src/server/client_session.rs").exists());
        assert!(root.join("root_src/tui/app.rs").exists());
        assert!(root.join("root_src/tui/session_picker.rs").exists());
        assert!(root.join("root_src/tui/account_picker.rs").exists());
        assert!(root.join("root_src/tui/login_picker.rs").exists());
        assert!(root.join("root_src/mcp/manager.rs").exists());
        assert!(root.join("root_src/ambient/runner.rs").exists());
        assert!(root.join("root_src/overnight.rs").exists());
        assert!(root.join("root_src/gmail.rs").exists());
        assert!(root.join("root_src/tool/selfdev/mod.rs").exists());
        assert!(root.join("crates/jcode-swarm-core/src/lib.rs").exists());
        assert!(root.join("crates/jcode-overnight-core/src/lib.rs").exists());
        assert!(root.join("crates/jcode-notify-email/src/lib.rs").exists());
        assert!(root.join("crates/jcode-selfdev-types/src/lib.rs").exists());
        assert!(root.join("crates/jcode-agent-runtime/src/lib.rs").exists());
        assert!(root.join("crates/jcode-tool-core/src/lib.rs").exists());
        assert!(root.join("crates/jcode-tui-core/src/lib.rs").exists());
        assert!(
            root.join("crates/jcode-tui-session-picker/src/lib.rs")
                .exists()
        );
        assert!(
            root.join("crates/jcode-tui-account-picker/src/lib.rs")
                .exists()
        );
        assert!(root.join("crates/jcode-desktop/src/main.rs").exists());
        assert!(root.join("crates/jcode-mobile-core/src/lib.rs").exists());
        assert!(root.join("UPSTREAM_MANIFEST.sha256").exists());
    }

    #[test]
    fn vendored_jcode_core_inventory_matches_import() {
        let root = crate_root().join("src/jcode_core/vendor");
        let mut root_files = 0usize;
        let mut crate_files = 0usize;
        for entry in walk_rs_files(&root.join("root_src")) {
            if entry.ends_with(".rs") {
                root_files += 1;
            }
        }
        for entry in walk_rs_files(&root.join("crates")) {
            if entry.ends_with(".rs") {
                crate_files += 1;
            }
        }
        assert_eq!(root_files, VENDORED_INVENTORY.root_rust_files);
        assert_eq!(crate_files, VENDORED_INVENTORY.crate_rust_files);
        assert_eq!(
            root_files + crate_files,
            VENDORED_INVENTORY.total_rust_files
        );
    }

    fn walk_rs_files(root: &std::path::Path) -> Vec<String> {
        let mut result = Vec::new();
        let Ok(entries) = std::fs::read_dir(root) else {
            return result;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                result.extend(walk_rs_files(&path));
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
                result.push(path.display().to_string());
            }
        }
        result
    }
}
