use chrono::Datelike;

use super::types::{ComputedPersona, SignalBundle, SignalConsensus};

/// 合并本地信号，计算 ComputedPersona。
///
/// 降级链:
///   signals → os username only → empty fallback
///
/// 身份推断使用共识投票（`SignalConsensus`）而非固定优先级链：
/// 多个独立信号源指向同一值 → 高置信；交叉验证（email 本地部分 == username）额外加成。
pub fn compute_persona(signals: &SignalBundle) -> ComputedPersona {
    let signal_sources: Vec<String> = signals
        .source_labels()
        .into_iter()
        .map(String::from)
        .collect();

    let consensus = signals.build_consensus();

    // ── 完全无信号 → 降级（identity_name 为空） ──
    if signal_sources.is_empty() {
        return ComputedPersona::fallback_lyra();
    }

    // ── 有信号但共识全空 → 降级 ──
    // ponytail: 理论上 source_labels 非空说明有字段被填，但可能都是空 Vec。
    // 这种极端情况降级比用 "unknown" 更合理。
    if consensus.best_email.is_none()
        && consensus.best_username.is_none()
        && consensus.best_name.is_none()
    {
        return ComputedPersona::fallback_lyra();
    }

    // ── 收集 emails — 从共识 + 所有来源 ──
    let mut emails: Vec<String> = Vec::new();
    if let Some(e) = &consensus.best_email {
        emails.push(e.clone());
    }
    // 补充其他 email 来源（去重）
    for e in [
        &signals.git_email,
        &signals.git_dominant_email,
        &signals.lyra_config_email,
        &signals.npm_email,
        &signals.pip_email,
        &signals.vscode_sync_email,
        &signals.macos_contacts_email,
    ] {
        if let Some(email) = e {
            if !emails.contains(email) {
                emails.push(email.clone());
            }
        }
    }
    for e in &signals.browser_autofill_emails {
        if !emails.contains(e) {
            emails.push(e.clone());
        }
    }

    // ── 收集 usernames — 从共识 + candidates ──
    let mut usernames = signals.username_candidates();
    if let Some(u) = &consensus.best_username {
        if !usernames.contains(u) {
            usernames.insert(0, u.clone());
        }
    }

    // ── 确定最佳姓名 — 共识投票优先 ──
    // 优先级: consensus best_name (多源投票) > OS username
    let identity_name = consensus
        .best_name
        .clone()
        .or_else(|| signals.os_username.clone())
        .unwrap_or_default();

    // ── 计算置信度 — 共识 + 交叉验证 ──
    let confidence = calculate_confidence(&consensus);

    // ── 推断年龄 — 弱信号 ──
    let inferred_age = infer_age(signals);

    ComputedPersona {
        identity_name,
        identity_usernames: usernames,
        identity_emails: emails,
        confidence,
        signal_sources,
        is_fallback: false,
        inferred_age,
    }
}

/// 置信度计算 — 共识投票数 + 交叉验证。
///
/// 维度权重:
///   - 共识投票: 每票 0.08，email/username/name 各最多 3 票 → 0.72
///   - 交叉验证 (email 本地部分 == username): +0.15
///   - 上限: 0.5（本地信号仍然具有不确定性）
fn calculate_confidence(consensus: &SignalConsensus) -> f32 {
    let email_score = (consensus.best_email_votes as f32 * 0.08).min(0.24);
    let username_score = (consensus.best_username_votes as f32 * 0.08).min(0.24);
    let name_score = (consensus.best_name_votes as f32 * 0.08).min(0.24);
    let cross_bonus = if consensus.cross_validated { 0.15 } else { 0.0 };

    (email_score + username_score + name_score + cross_bonus).min(0.5)
}

/// 从弱信号推算年龄 — 家目录创建时间 / 首次 git commit。
///
/// ponytail: 只能给年龄下限。假设用户创建账户/首次 commit 时 16 岁。
/// 合理范围 10-80，超出则返回 None（→ 默认 21）。
fn infer_age(signals: &SignalBundle) -> Option<u32> {
    let current_year = chrono::Utc::now().year();

    let earliest_year = signals
        .home_dir_birthtime
        .map(|t| chrono::DateTime::from_timestamp(t, 0).map(|dt| dt.year()))
        .flatten()
        .into_iter()
        .chain(
            signals
                .git_first_commit_date
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.year()),
        )
        .min()?;

    let birth_year = earliest_year.saturating_sub(16);
    let age = current_year.saturating_sub(birth_year) as u32;

    if (10..=80).contains(&age) {
        Some(age)
    } else {
        None
    }
}
