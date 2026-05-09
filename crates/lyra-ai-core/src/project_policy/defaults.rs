use super::types::{
    AgentVmProjectPolicy, CapsuleSnapshotPolicy, CommandPolicy, EffectivePolicy,
    ExternalWritePolicy, ModelFallbackPolicy, ModelRoutingPolicy, NetworkPolicy, PermissionPolicy,
    RollbackRetentionPolicy, SecurityPolicy, ToolPolicy, WorkspacePolicy,
};

pub fn product_default_policy() -> EffectivePolicy {
    let permission_default = "sandbox".to_string();
    let allowed_modes = vec!["sandbox".to_string()];
    EffectivePolicy {
        project_id: None,
        name: None,
        permission_default: permission_default.clone(),
        allowed_modes: allowed_modes.clone(),
        permission: PermissionPolicy {
            default_mode: permission_default,
            allowed_modes,
            default_execution_target: "host".to_string(),
            allowed_execution_targets: vec!["host".to_string(), "agent_vm".to_string()],
            allow_temporary_elevation: true,
            full_access_requires_user_enablement: true,
            agent_vm_requires_user_enablement: true,
            approval_timeout_seconds: 600,
            auto_approval_audit_required: true,
        },
        workspace: WorkspacePolicy {
            root: ".".to_string(),
            trusted: false,
            trusted_roots: vec![".".to_string()],
            writable: vec![".".to_string()],
            readonly: Vec::new(),
            denied: vec![
                ".env".to_string(),
                ".env.*".to_string(),
                ".ssh".to_string(),
                ".aws".to_string(),
                "*.pem".to_string(),
                "*.key".to_string(),
            ],
            include_globs: vec!["**/*".to_string()],
            exclude_globs: vec![
                "**/.git/**".to_string(),
                "**/node_modules/**".to_string(),
                "**/target/**".to_string(),
            ],
            max_file_read_bytes: Some(256 * 1024),
            max_directory_walk_entries: Some(10_000),
            symlink_policy: "follow_within_scope".to_string(),
        },
        models: ModelRoutingPolicy {
            default_provider: None,
            default_model: None,
            privacy_route: "policy_controlled".to_string(),
            allowed_providers: Vec::new(),
            denied_providers: Vec::new(),
            allowed_protocols: vec![
                "openai".to_string(),
                "anthropic".to_string(),
                "gemini".to_string(),
                "ollama".to_string(),
                "llama.cpp".to_string(),
                "responses".to_string(),
            ],
            require_native_adapter: true,
            fallback: ModelFallbackPolicy {
                enabled: true,
                require_same_capabilities: true,
                require_same_privacy_route: true,
            },
            purposes: serde_json::json!({}),
        },
        tools: ToolPolicy {
            enabled: Vec::new(),
            disabled: Vec::new(),
            command_policy: "safe_default".to_string(),
            command: CommandPolicy {
                allow_shell: true,
                allowed_commands: Vec::new(),
                denied_commands: vec!["rm -rf /".to_string()],
                require_approval_for_patterns: Vec::new(),
                max_timeout_ms: 300_000,
                max_output_bytes: 256 * 1024,
            },
            network_policy: "disabled".to_string(),
            network: NetworkPolicy {
                mode: "disabled".to_string(),
                allowed_domains: Vec::new(),
                denied_domains: Vec::new(),
                allow_downloads: false,
                allow_uploads: false,
            },
            external_write: ExternalWritePolicy {
                default: "approval_required".to_string(),
                targets: Vec::new(),
            },
            risk_overrides: Vec::new(),
            package_policy: None,
        },
        agent_defaults: serde_json::json!({}),
        rollback: RollbackRetentionPolicy {
            message_checkpoint_retention_days: 30,
            workspace_snapshot_retention_days: 14,
            artifact_retention_days: 90,
            max_snapshots_per_session: None,
            preserve_external_side_effect_ledger: true,
            preserve_delivery_proofs: true,
            cleanup_policy: "hybrid".to_string(),
        },
        agent_vm: AgentVmProjectPolicy {
            enabled: false,
            default_image_id: None,
            image_manifest_ref: None,
            guest_workspace_path: "/workspace".to_string(),
            mounts: Vec::new(),
            network_mode: "disabled".to_string(),
            allowed_domains: Vec::new(),
            expose_secrets: Vec::new(),
            expose_ssh_agent: false,
            port_forwards: Vec::new(),
            snapshot: CapsuleSnapshotPolicy {
                auto_snapshot_before_task: true,
                retain_count: 3,
            },
        },
        security: SecurityPolicy {
            policy_file: None,
            secrets_policy_file: None,
            redaction_profile: "strict".to_string(),
            sensitive_file_default: "allow_redacted".to_string(),
            allow_model_context_secrets: false,
            allow_artifact_raw_secrets: false,
            allow_agent_vm_secret_exposure: false,
            env_list_visibility: "name_only".to_string(),
        },
        artifacts: serde_json::json!({}),
        references: serde_json::json!({}),
        warnings: Vec::new(),
    }
}

pub fn fallback_safe_default_policy(warning: impl Into<String>) -> EffectivePolicy {
    let mut policy = product_default_policy();
    policy.warnings.push(warning.into());
    policy
}
