use super::types::{SecretDetectionReport, SecretFinding};

pub fn redact_secrets(input: &str) -> String {
    detect_and_redact(input).redacted
}

pub fn detect_and_redact(input: &str) -> SecretDetectionReport {
    let mut findings = Vec::new();
    let mut redacted = redact_private_key_blocks(input, &mut findings);
    redacted = redact_database_urls(&redacted, &mut findings);
    redacted = redact_labeled_lines(&redacted, &mut findings);
    redacted = redact_prefixed_tokens(&redacted, &mut findings);
    redacted = redact_jwt_tokens(&redacted, &mut findings);
    SecretDetectionReport { findings, redacted }
}

fn redact_private_key_blocks(input: &str, findings: &mut Vec<SecretFinding>) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_key = false;
    for segment in input.split_inclusive('\n') {
        let (line, ending) = split_line_ending(segment);
        if line.contains("-----BEGIN") && line.contains("PRIVATE KEY-----") {
            findings.push(finding(
                "private_key_block",
                "high",
                "-----BEGIN PRIVATE KEY-----",
            ));
            output.push_str("[REDACTED_PRIVATE_KEY]");
            output.push_str(ending);
            in_key = true;
            continue;
        }
        if in_key {
            if line.contains("-----END") && line.contains("PRIVATE KEY-----") {
                in_key = false;
            }
            continue;
        }
        output.push_str(line);
        output.push_str(ending);
    }
    output
}

fn redact_database_urls(input: &str, findings: &mut Vec<SecretFinding>) -> String {
    redact_tokens_preserving_whitespace(input, |token| {
        if let Some(redacted) = redact_database_url_token(token) {
            findings.push(finding("database_url_password", "high", "://user:***@host"));
            Some(redacted)
        } else {
            None
        }
    })
}

fn redact_database_url_token(token: &str) -> Option<String> {
    let scheme_end = token.find("://")?;
    let after_scheme = scheme_end + 3;
    let at = token[after_scheme..].find('@')? + after_scheme;
    let colon = token[after_scheme..at].find(':')? + after_scheme;
    Some(format!("{}[REDACTED]{}", &token[..=colon], &token[at..]))
}

fn redact_labeled_lines(input: &str, findings: &mut Vec<SecretFinding>) -> String {
    let mut output = String::with_capacity(input.len());
    for segment in input.split_inclusive('\n') {
        let (line, ending) = split_line_ending(segment);
        let lower = line.to_ascii_lowercase();
        let redacted = if lower.contains("authorization: bearer") {
            findings.push(finding(
                "authorization_bearer",
                "high",
                "Authorization: Bearer ***",
            ));
            redact_after_separator(line, ':')
        } else if secret_assignment_label(&lower).is_some() {
            findings.push(finding(
                "secret_like_label",
                "high",
                "secret-like assignment",
            ));
            if line.contains('=') {
                redact_after_separator(line, '=')
            } else if line.contains(':') {
                redact_after_separator(line, ':')
            } else {
                line.to_string()
            }
        } else {
            line.to_string()
        };
        output.push_str(&redacted);
        output.push_str(ending);
    }
    output
}

fn redact_prefixed_tokens(input: &str, findings: &mut Vec<SecretFinding>) -> String {
    let mut value = input.to_string();
    for prefix in ["sk-", "tp-", "ghp_", "gho_", "xoxb-", "AKIA"] {
        if value.contains(prefix) {
            findings.push(finding("prefixed_token", "high", prefix));
        }
        value = redact_prefixed_token(&value, prefix);
    }
    value
}

fn redact_jwt_tokens(input: &str, findings: &mut Vec<SecretFinding>) -> String {
    redact_tokens_preserving_whitespace(input, |token| {
        if looks_like_jwt(token) {
            findings.push(finding("jwt", "high", "ey..."));
            Some("[REDACTED_JWT]".to_string())
        } else {
            None
        }
    })
}

fn redact_tokens_preserving_whitespace<F>(input: &str, mut redact_token: F) -> String
where
    F: FnMut(&str) -> Option<String>,
{
    let mut output = String::with_capacity(input.len());
    let mut token_start: Option<usize> = None;
    for (index, ch) in input.char_indices() {
        if ch.is_whitespace() {
            if let Some(start) = token_start.take() {
                let token = &input[start..index];
                output.push_str(&redact_token(token).unwrap_or_else(|| token.to_string()));
            }
            output.push(ch);
        } else if token_start.is_none() {
            token_start = Some(index);
        }
    }
    if let Some(start) = token_start {
        let token = &input[start..];
        output.push_str(&redact_token(token).unwrap_or_else(|| token.to_string()));
    }
    output
}

fn split_line_ending(segment: &str) -> (&str, &str) {
    if let Some(line) = segment.strip_suffix("\r\n") {
        (line, "\r\n")
    } else if let Some(line) = segment.strip_suffix('\n') {
        (line, "\n")
    } else {
        (segment, "")
    }
}

fn secret_assignment_label(lower: &str) -> Option<&str> {
    let separator = lower.find('=').into_iter().chain(lower.find(':')).min()?;
    let label = lower[..separator].trim().trim_matches(|ch: char| {
        ch == '"'
            || ch == '\''
            || ch == '`'
            || ch == '{'
            || ch == '['
            || ch == '-'
            || ch.is_whitespace()
    });
    if label.is_empty() {
        return None;
    }
    let normalized = label
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let parts = normalized
        .split('_')
        .filter(|part| part.is_empty() == false)
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return None;
    }
    if normalized.contains("api_key")
        || normalized.contains("private_key")
        || normalized.contains("access_token")
        || normalized.contains("refresh_token")
        || normalized.contains("auth_token")
        || parts.iter().any(|part| {
            matches!(
                *part,
                "apikey" | "token" | "secret" | "password" | "passwd" | "cookie" | "authorization"
            )
        })
    {
        Some(label)
    } else {
        None
    }
}

fn redact_after_separator(line: &str, separator: char) -> String {
    let Some(index) = line.find(separator) else {
        return "[REDACTED]".to_string();
    };
    format!("{}{} [REDACTED]", line[..index].trim_end(), separator)
}

fn redact_prefixed_token(value: &str, prefix: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut index = 0;
    while index < value.len() {
        let rest = &value[index..];
        if rest.starts_with(prefix) {
            output.push_str("[REDACTED]");
            index += prefix.len();
            while index < value.len() {
                let Some(ch) = value[index..].chars().next() else {
                    break;
                };
                if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                    index += ch.len_utf8();
                } else {
                    break;
                }
            }
            continue;
        }
        let Some(ch) = rest.chars().next() else {
            break;
        };
        output.push(ch);
        index += ch.len_utf8();
    }
    output
}

fn looks_like_jwt(token: &str) -> bool {
    let parts = token.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|part| part.len() >= 12)
        && parts.iter().all(|part| {
            part.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        })
}

fn finding(kind: &str, confidence: &str, preview: &str) -> SecretFinding {
    SecretFinding {
        kind: kind.to_string(),
        confidence: confidence.to_string(),
        preview: preview.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detector_redacts_obvious_values() {
        let report = detect_and_redact(
            "api_key = sk-secret-value\nAuthorization: Bearer token-value\nplain tp-secret",
        );

        assert!(report.redacted.contains("sk-secret") == false);
        assert!(report.redacted.contains("tp-secret") == false);
        assert!(report.redacted.contains("token-value") == false);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.confidence == "high"));
    }

    #[test]
    fn private_key_block_never_enters_redacted_output() {
        let report = detect_and_redact(
            "before\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\nafter",
        );

        assert!(report.redacted.contains("secret") == false);
        assert!(report.redacted.contains("[REDACTED_PRIVATE_KEY]"));
    }

    #[test]
    fn database_url_password_is_redacted_without_filename_false_positive() {
        let report = detect_and_redact(
            "DATABASE_URL=postgres://user:password@localhost/db\nnormal file name README.md",
        );

        assert!(report.redacted.contains("password@") == false);
        assert!(report.redacted.contains("README.md"));
        assert!(report.redacted.contains('\n'));
    }

    #[test]
    fn token_redaction_preserves_line_structure() {
        let report = detect_and_redact("one\ntwo\nthree\n");

        assert_eq!(report.redacted, "one\ntwo\nthree\n");
    }

    #[test]
    fn runtime_resume_token_is_not_treated_as_secret_assignment() {
        let report = detect_and_redact(
            r#"- openClarificationTickets=[]; recentAnsweredClarifications=[{"resumeToken":"runtime_turn:turn_1","answerText":"Use README.md"}]; safeAssumptions=[]."#,
        );

        assert!(report.findings.is_empty());
        assert!(report.redacted.contains("resumeToken"));
        assert!(report.redacted.contains("answerText"));
    }

    #[test]
    fn label_assignment_detection_uses_left_hand_field() {
        let report = detect_and_redact(
            "api_key: secret-value\nnote: this line mentions token and password but is not a secret field",
        );

        assert!(report.redacted.contains("api_key: [REDACTED]"));
        assert!(report.redacted.contains("mentions token and password"));
    }
}
