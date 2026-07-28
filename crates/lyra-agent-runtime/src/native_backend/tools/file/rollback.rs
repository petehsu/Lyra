use super::*;

pub(super) fn rollback_staged_patch_operations(applied: &[StagedPatchOperation]) {
    for operation in applied.iter().rev() {
        match operation {
            StagedPatchOperation::Write {
                absolute, before, ..
            } => {
                if let Some(before) = before {
                    let _ = fs::write(absolute, before);
                } else {
                    let _ = fs::remove_file(absolute);
                }
            }
            StagedPatchOperation::Delete {
                absolute, before, ..
            } => {
                if let Some(parent) = absolute.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(absolute, before);
            }
            StagedPatchOperation::Move {
                from_absolute,
                to_absolute,
                ..
            } => {
                let _ = fs::rename(to_absolute, from_absolute);
            }
        }
    }
}
