use super::*;

#[derive(Clone, Default)]
pub(super) struct ShellSecrets(Vec<(String, String)>);

impl ShellSecrets {
    pub(super) fn stream(&self) -> SecretOutputStream {
        let mut secrets: Vec<_> = self
            .0
            .iter()
            .map(|(_, value)| value.as_bytes().to_vec())
            .collect();
        // A password may also be a prefix of another credential. Match the
        // longest value first so replacing the prefix cannot expose its tail.
        secrets.sort_by_key(|value| std::cmp::Reverse(value.len()));
        SecretOutputStream {
            secrets,
            pending: Vec::new(),
        }
    }
    pub(super) async fn resolve(input: &Value) -> Result<Self, NativeToolFailure> {
        let Some(bindings) = input.get("sensitiveEnv") else {
            return Ok(Self::default());
        };
        let bad = || {
            NativeToolFailure::new(
                "invalid_sensitive_env",
                "sensitiveEnv must bind LYRA_SECRET_* names to secure value references",
                "Use the reference returned by the browser, never a plaintext value.",
            )
        };
        let bindings = bindings
            .as_object()
            .filter(|bindings| bindings.len() <= 16)
            .ok_or_else(bad)?;
        // Validate every binding before resolving any credential.
        for (key, value) in bindings {
            if !key.starts_with("LYRA_SECRET_")
                || !is_safe_env_key(key)
                || value.get("kind").and_then(Value::as_str) != Some("lyra-sensitive-value-ref")
            {
                return Err(bad());
            }
        }
        let dispatcher = host_dispatcher().ok_or_else(|| {
            NativeToolFailure::new(
                "sensitive_storage_unavailable",
                "Secure credential storage is unavailable",
                "Restore the desktop credential bridge before running this command.",
            )
        })?;
        let mut values = Vec::new();
        for (key, reference) in bindings {
            let resolved = invoke_host_capability_with_timeout_async(
                dispatcher.clone(),
                "sensitiveValues.resolveForAgentUse".into(),
                json!({"ref": reference, "reason": "shell-environment"}),
                10_000,
            )
            .await
            .map_err(|_| {
                NativeToolFailure::new(
                    "sensitive_value_unavailable",
                    "Credential reference could not be resolved",
                    "Use a current secure value reference.",
                )
            })?;
            let value = resolved
                .get("value")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty() && !s.contains('\0'))
                .ok_or_else(bad)?;
            values.push((key.clone(), value.to_string()));
        }
        Ok(Self(values))
    }
    pub(super) fn apply(&self, command: &mut tokio::process::Command) {
        for (key, value) in &self.0 {
            command.env(key, value);
        }
    }
    pub(super) fn redact(&self, text: &str) -> String {
        let mut text = text.to_string();
        let mut values: Vec<_> = self.0.iter().collect();
        values.sort_by_key(|(_, value)| std::cmp::Reverse(value.len()));
        for (key, value) in values {
            text = text.replace(value, &format!("[sensitive:{key}]"));
        }
        text
    }
}

/// Redact before head/tail truncation or artifact persistence. A pipe read can
/// split a credential at any byte; retain only the undecidable suffix.
pub(super) struct SecretOutputStream {
    secrets: Vec<Vec<u8>>,
    pending: Vec<u8>,
}
impl SecretOutputStream {
    pub(super) fn push(&mut self, chunk: &[u8], eof: bool) -> Vec<u8> {
        if self.secrets.is_empty() {
            return chunk.to_vec();
        }
        self.pending.extend_from_slice(chunk);
        let keep = self
            .secrets
            .iter()
            .map(Vec::len)
            .max()
            .unwrap_or(1)
            .saturating_sub(1);
        let mut index = 0;
        let mut safe = Vec::new();
        while index < self.pending.len() && (eof || self.pending.len() - index > keep) {
            let remaining = &self.pending[index..];
            let matched = self
                .secrets
                .iter()
                .find(|secret| remaining.starts_with(secret));
            if let Some(secret) = matched {
                safe.extend_from_slice(b"[sensitive value]");
                index += secret.len();
            } else if eof
                && remaining.len() >= 8
                && self
                    .secrets
                    .iter()
                    .any(|secret| secret.starts_with(remaining))
            {
                safe.extend_from_slice(b"[sensitive value]");
                index = self.pending.len();
            } else {
                safe.push(self.pending[index]);
                index += 1;
            }
        }
        self.pending.drain(..index);
        safe
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secrets_are_environment_only_and_echoes_are_redacted() {
        let secrets = ShellSecrets(vec![(
            "LYRA_SECRET_TEST".into(),
            "test-secret-not-real".into(),
        )]);
        let mut command = tokio::process::Command::new("echo");
        command.arg("ordinary argument");
        secrets.apply(&mut command);
        assert_eq!(command.as_std().get_args().count(), 1);
        assert_eq!(
            secrets.redact("echo test-secret-not-real"),
            "echo [sensitive:LYRA_SECRET_TEST]"
        );
    }
    #[test]
    fn stream_redacts_every_split_before_output_can_be_truncated() {
        let secret = "regression-credential-not-real";
        let secrets = ShellSecrets(vec![("LYRA_SECRET_TEST".into(), secret.into())]);
        for split in 0..=secret.len() {
            let mut stream = secrets.stream();
            let mut safe = stream.push(&secret.as_bytes()[..split], false);
            safe.extend(stream.push(&secret.as_bytes()[split..], false));
            safe.extend(stream.push(b"", true));
            assert_eq!(safe, b"[sensitive value]");
        }
    }

    #[test]
    fn overlapping_credentials_never_expose_the_longer_suffix() {
        let short = "fixture-credential";
        let long = "fixture-credential-longer-value";
        let secrets = ShellSecrets(vec![
            ("LYRA_SECRET_SHORT".into(), short.into()),
            ("LYRA_SECRET_LONG".into(), long.into()),
        ]);
        for split in 0..=long.len() {
            let mut stream = secrets.stream();
            let mut safe = stream.push(&long.as_bytes()[..split], false);
            safe.extend(stream.push(&long.as_bytes()[split..], true));
            assert_eq!(safe, b"[sensitive value]");
        }
        assert_eq!(secrets.redact(long), "[sensitive:LYRA_SECRET_LONG]");
    }
}
