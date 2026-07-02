use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use lyra_code_intel_core::{CodeGraphEngine, IndexStatus};
use tempfile::tempdir;

fn write_file(path: &Path, content: &str) {
    fs::write(path, content).unwrap();
}

fn wait_ready(
    engine: &CodeGraphEngine,
    root: &Path,
    matches_ready: impl Fn(u64, u64) -> bool,
) -> IndexStatus {
    let deadline = Instant::now() + Duration::from_secs(12);
    let mut last = IndexStatus::Idle;
    while Instant::now() < deadline {
        last = engine.status_sync(root);
        if let IndexStatus::Ready {
            file_count,
            symbol_count,
        } = last
        {
            if matches_ready(file_count, symbol_count) {
                return last;
            }
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("timed out waiting for ready status, last={last:?}");
}

fn wait_until(label: &str, condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        if condition() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("timed out waiting for {label}");
}

fn new_engine(storage: &Path) -> CodeGraphEngine {
    CodeGraphEngine::new(storage.to_path_buf())
}

fn git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed");
}

#[test]
fn ready_partial_persisted_graph_is_rebuilt() {
    let storage = tempdir().unwrap();
    let project = tempdir().unwrap();
    let root = project.path().to_path_buf();
    write_file(&root.join("a.rs"), "pub fn alpha() {}\n");

    {
        let engine = new_engine(storage.path());
        engine.index_project_sync(root.clone()).unwrap();
        wait_ready(&engine, &root, |files, _symbols| files >= 1);
    }

    write_file(&root.join("b.rs"), "pub fn beta() {}\n");
    write_file(&root.join("c.rs"), "pub fn gamma() {}\n");

    let engine = new_engine(storage.path());
    engine.index_project_sync(root.clone()).unwrap();
    wait_ready(&engine, &root, |files, _symbols| files >= 3);
}

#[test]
fn git_scope_keeps_untracked_external_tree_out_but_indexes_project_new_files() {
    let storage = tempdir().unwrap();
    let project = tempdir().unwrap();
    let root = project.path().to_path_buf();
    fs::create_dir_all(root.join("crates/app/src")).unwrap();
    fs::create_dir_all(root.join("external-copy/src")).unwrap();
    write_file(
        &root.join("Cargo.toml"),
        "[workspace]\nmembers = [\"crates/app\"]\n",
    );
    write_file(
        &root.join("crates/app/src/lib.rs"),
        "pub fn tracked_app() {}\n",
    );
    write_file(
        &root.join("crates/app/src/new_file.rs"),
        "pub fn untracked_project_file() {}\n",
    );
    write_file(
        &root.join("external-copy/src/lib.rs"),
        "pub fn external_copy_only() {}\n",
    );
    git(&root, &["init"]);
    git(&root, &["add", "Cargo.toml", "crates/app/src/lib.rs"]);

    let engine = new_engine(storage.path());
    engine.index_project_sync(root.clone()).unwrap();
    wait_ready(&engine, &root, |files, _symbols| files >= 2);

    let project_matches = engine
        .search_symbols_sync(&root, "untracked_project_file", 10)
        .unwrap();
    assert!(!project_matches.is_empty());
    let external_matches = engine
        .search_symbols_sync(&root, "external_copy_only", 10)
        .unwrap();
    assert!(external_matches.is_empty());

    let context = engine.project_context_sync(&root).unwrap();
    assert_eq!(context.scope.source, "git");
    assert!(
        context
            .scope
            .excluded_path_samples
            .iter()
            .any(|path| path.contains("external-copy/src/lib.rs")),
        "scope should explain structurally excluded files: {:?}",
        context.scope.excluded_path_samples
    );
}

#[test]
fn rebuild_project_ignores_old_hash_state_and_prunes_deleted_files() {
    let storage = tempdir().unwrap();
    let project = tempdir().unwrap();
    let root = project.path().to_path_buf();
    write_file(&root.join("a.rs"), "pub fn alpha() {}\n");
    let removed = root.join("b.rs");
    write_file(&removed, "pub fn beta() {}\n");

    let engine = new_engine(storage.path());
    engine.index_project_sync(root.clone()).unwrap();
    wait_ready(&engine, &root, |files, _symbols| files >= 2);

    fs::remove_file(removed).unwrap();
    engine.rebuild_project_sync(root.clone()).unwrap();
    wait_ready(&engine, &root, |files, _symbols| files == 1);
}

#[test]
fn watcher_updates_changed_file_and_clears_staleness() {
    let storage = tempdir().unwrap();
    let project = tempdir().unwrap();
    let root = project.path().to_path_buf();
    let source = root.join("a.rs");
    write_file(&source, "pub fn alpha_unique_codegraph_test() {}\n");

    let engine = new_engine(storage.path());
    engine.index_project_sync(root.clone()).unwrap();
    wait_ready(&engine, &root, |files, _symbols| files == 1);

    write_file(&source, "pub fn beta_unique_codegraph_test() {}\n");

    wait_until("watcher query refresh", || {
        engine
            .search_symbols_sync(&root, "beta_unique_codegraph_test", 10)
            .map(|matches| !matches.is_empty())
            .unwrap_or(false)
    });
    wait_until("fresh staleness", || {
        engine
            .staleness_sync(&root)
            .map(|staleness| !staleness.stale)
            .unwrap_or(false)
    });
}

#[test]
fn watcher_removes_deleted_file_from_ready_counts() {
    let storage = tempdir().unwrap();
    let project = tempdir().unwrap();
    let root: PathBuf = project.path().to_path_buf();
    write_file(&root.join("a.rs"), "pub fn alpha() {}\n");
    let removed = root.join("b.rs");
    write_file(&removed, "pub fn beta() {}\n");

    let engine = new_engine(storage.path());
    engine.index_project_sync(root.clone()).unwrap();
    wait_ready(&engine, &root, |files, _symbols| files >= 2);

    fs::remove_file(removed).unwrap();
    wait_ready(&engine, &root, |files, _symbols| files == 1);
}
