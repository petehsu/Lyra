use super::control::clear_memory_root_contents;
use super::lyra_truth::initialize_thread_memory_truth;
use crate::memories::lyra_truth_root_path;
use crate::memories::memory_root;
use lyra_utils_absolute_path::AbsolutePathBuf;
use pretty_assertions::assert_eq;
use tempfile::tempdir;

#[test]
fn memory_root_points_at_lyra_truth_root() {
    let lyra_home = AbsolutePathBuf::current_dir().expect("cwd").join("lyra");
    let expected = AbsolutePathBuf::current_dir()
        .expect("cwd")
        .join("modules")
        .join("ai");
    assert_eq!(memory_root(&lyra_home), expected);
}

#[test]
fn initialize_thread_memory_truth_creates_lyra_truth_layout() {
    let dir = tempdir().expect("tempdir");
    let lyra_home = AbsolutePathBuf::from_absolute_path(dir.path())
        .expect("absolute temp path")
        .join("lyra");

    initialize_thread_memory_truth(lyra_home.as_ref(), "thread-1")
        .expect("initialize Lyra memory truth");

    let truth_root = lyra_truth_root_path(lyra_home.as_ref());
    assert!(truth_root.join("shared/shared_memory.md").exists());
    assert!(truth_root.join("shared/frozen_memory.md").exists());
    assert!(truth_root.join("shared/dynamic_prompt_cache.md").exists());
    assert!(truth_root.join("runtime/trigger_marks.sqlite").exists());
    assert!(truth_root.join("runtime/memory_jobs.sqlite").exists());
    assert!(truth_root.join("runtime/prompt_cache.sqlite").exists());
    assert!(truth_root.join("sessions/thread-1/session.sqlite").exists());
    assert!(
        truth_root
            .join("sessions/thread-1/manifests/cuts.manifest.json")
            .exists()
    );
}

#[tokio::test]
async fn clear_memory_root_contents_preserves_root_directory() {
    let dir = tempdir().expect("tempdir");
    let root = dir.path().join("memory");
    let nested_dir = root.join("shared");
    tokio::fs::create_dir_all(&nested_dir)
        .await
        .expect("create nested dir");
    tokio::fs::write(root.join("shared_memory.md"), "stale memory\n")
        .await
        .expect("write stale file");
    tokio::fs::write(nested_dir.join("child.md"), "stale nested file\n")
        .await
        .expect("write stale nested file");

    clear_memory_root_contents(&root)
        .await
        .expect("clear memory root contents");

    assert!(
        tokio::fs::try_exists(&root)
            .await
            .expect("check memory root existence"),
        "memory root should still exist after clearing contents"
    );
    let mut entries = tokio::fs::read_dir(&root)
        .await
        .expect("read memory root after clear");
    assert!(
        entries
            .next_entry()
            .await
            .expect("read next entry")
            .is_none(),
        "memory root should be empty after clearing contents"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn clear_memory_root_contents_rejects_symlinked_root() {
    let dir = tempdir().expect("tempdir");
    let target = dir.path().join("outside");
    tokio::fs::create_dir_all(&target)
        .await
        .expect("create symlink target dir");
    let target_file = target.join("keep.txt");
    tokio::fs::write(&target_file, "keep\n")
        .await
        .expect("write target file");

    let root = dir.path().join("memory");
    std::os::unix::fs::symlink(&target, &root).expect("create memory root symlink");

    let err = clear_memory_root_contents(&root)
        .await
        .expect_err("symlinked memory root should be rejected");
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    assert!(
        tokio::fs::try_exists(&target_file)
            .await
            .expect("check target file existence"),
        "rejecting a symlinked memory root should not delete the symlink target"
    );
}
