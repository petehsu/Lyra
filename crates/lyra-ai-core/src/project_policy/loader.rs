use super::defaults::{fallback_safe_default_policy, product_default_policy};
use super::manifest::{find_manifest, read_manifest};
use super::merge::merge_manifest;
use super::types::{PolicyLoadDraft, PolicySourceRecord};
use crate::storage::{sha256_hex, trim_to_string};
use std::fs;
use std::path::Path;

pub fn load_policy_draft(project_root: Option<&str>) -> PolicyLoadDraft {
    let Some(root) = project_root.and_then(trim_to_string) else {
        return product_default("workspace_root_missing".to_string());
    };
    let root_path = Path::new(&root);
    let Some(manifest_path) = find_manifest(root_path) else {
        return product_default("project_manifest_missing".to_string());
    };
    let manifest_path_text = manifest_path.to_string_lossy().to_string();
    let manifest_bytes = fs::read(&manifest_path).unwrap_or_default();
    let manifest_hash = Some(sha256_hex(&manifest_bytes));
    match read_manifest(&manifest_path) {
        Ok(manifest) => PolicyLoadDraft {
            source: "project_manifest".to_string(),
            status: "active".to_string(),
            manifest_path: Some(manifest_path_text.clone()),
            manifest_hash: manifest_hash.clone(),
            effective_policy: merge_manifest(manifest),
            source_records: vec![
                product_source_record(),
                PolicySourceRecord {
                    layer: "project_manifest".to_string(),
                    source_ref: manifest_path_text,
                    status: "loaded".to_string(),
                    hash: manifest_hash,
                    warnings: Vec::new(),
                },
            ],
        },
        Err(error) => {
            let warning = format!("PROJECT_MANIFEST_INVALID: {error}");
            PolicyLoadDraft {
                source: "fallback_safe_default".to_string(),
                status: "fallback_safe_default".to_string(),
                manifest_path: Some(manifest_path_text.clone()),
                manifest_hash,
                effective_policy: fallback_safe_default_policy(warning.clone()),
                source_records: vec![
                    product_source_record(),
                    PolicySourceRecord {
                        layer: "project_manifest".to_string(),
                        source_ref: manifest_path_text,
                        status: "invalid".to_string(),
                        hash: None,
                        warnings: vec![warning],
                    },
                ],
            }
        }
    }
}

fn product_default(warning: String) -> PolicyLoadDraft {
    let mut policy = product_default_policy();
    policy.warnings.push(warning.clone());
    PolicyLoadDraft {
        source: "product_default".to_string(),
        status: "safe_default".to_string(),
        manifest_path: None,
        manifest_hash: None,
        effective_policy: policy,
        source_records: vec![PolicySourceRecord {
            warnings: vec![warning],
            ..product_source_record()
        }],
    }
}

fn product_source_record() -> PolicySourceRecord {
    PolicySourceRecord {
        layer: "product_default".to_string(),
        source_ref: "lyra:product-default-policy:v1".to_string(),
        status: "loaded".to_string(),
        hash: None,
        warnings: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn missing_manifest_uses_safe_defaults() {
        let temp = tempfile::tempdir().expect("tempdir");
        let draft = load_policy_draft(Some(temp.path().to_string_lossy().as_ref()));

        assert_eq!(draft.source, "product_default");
        assert_eq!(draft.status, "safe_default");
        assert_eq!(draft.effective_policy.permission_default, "sandbox");
    }

    #[test]
    fn valid_manifest_loads_project_source() {
        let temp = tempfile::tempdir().expect("tempdir");
        let manifest_dir = temp.path().join(".lyra");
        fs::create_dir_all(&manifest_dir).expect("manifest dir");
        fs::write(
            manifest_dir.join("project.manifest.json"),
            r#"{
              "schemaVersion": "v1",
              "projectId": "proj-test",
              "permission": { "default": "full_access", "allowedModes": ["sandbox", "full_access"] },
              "tools": { "disabled": ["/tools/shell/run_command"], "commandPolicy": "restricted" },
              "security": { "redactionProfile": "balanced", "sensitiveFileDefault": "deny" }
            }"#,
        )
        .expect("manifest");

        let draft = load_policy_draft(Some(temp.path().to_string_lossy().as_ref()));

        assert_eq!(draft.source, "project_manifest");
        assert_eq!(draft.status, "active");
        assert_eq!(
            draft.effective_policy.project_id.as_deref(),
            Some("proj-test")
        );
        assert_eq!(draft.effective_policy.permission_default, "full_access");
        assert_eq!(
            draft.effective_policy.security.redaction_profile,
            "balanced"
        );
    }

    #[test]
    fn malformed_manifest_falls_back_with_warning() {
        let temp = tempfile::tempdir().expect("tempdir");
        let manifest_dir = temp.path().join(".lyra");
        fs::create_dir_all(&manifest_dir).expect("manifest dir");
        fs::write(
            manifest_dir.join("project.manifest.json"),
            r#"{ "schemaVersion": "v99" }"#,
        )
        .expect("manifest");

        let draft = load_policy_draft(Some(temp.path().to_string_lossy().as_ref()));

        assert_eq!(draft.source, "fallback_safe_default");
        assert_eq!(draft.status, "fallback_safe_default");
        assert!(draft
            .effective_policy
            .warnings
            .iter()
            .any(|warning| warning.contains("PROJECT_MANIFEST_INVALID")));
    }
}
