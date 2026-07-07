use chrono::Datelike;

use super::types::{
    ComputedPersona, OsintProfile, PlatformIdentity, SignalBundle, SignalConsensus,
};

/// 合并本地信号 + OSINT 结果，计算 ComputedPersona。
///
/// 降级链:
///   signals + osint → signals only → os username only → empty fallback
///
/// 身份推断使用共识投票（`SignalConsensus`）而非固定优先级链：
/// 多个独立信号源指向同一值 → 高置信；交叉验证（email 本地部分 == username）额外加成。
pub fn compute_persona(
    signals: &SignalBundle,
    osint: Option<&OsintProfile>,
) -> ComputedPersona {
    let signal_sources: Vec<String> = signals
        .source_labels()
        .into_iter()
        .map(String::from)
        .collect();

    let consensus = signals.build_consensus();

    // ── 完全无信号无 OSINT → 降级（identity_name 为空） ──
    if signal_sources.is_empty()
        && osint.map(|o| o.hits.is_empty()).unwrap_or(true)
    {
        return ComputedPersona::fallback_lyra();
    }

    // ── 有信号但共识全空 → 降级 ──
    // ponytail: 理论上 source_labels 非空说明有字段被填，但可能都是空 Vec。
    // 这种极端情况降级比用 "unknown" 更合理。
    if consensus.best_email.is_none()
        && consensus.best_username.is_none()
        && consensus.best_name.is_none()
        && osint.map(|o| o.hits.is_empty()).unwrap_or(true)
    {
        return ComputedPersona::fallback_lyra();
    }

    // ── 收集 emails — 从共识 + 所有来源 ──
    let mut emails: Vec<String> = Vec::new();
    if let Some(e) = &consensus.best_email {
        emails.push(e.clone());
    }
    // 补充其他 email 来源（去重）
    for e in [&signals.git_email, &signals.git_dominant_email, &signals.lyra_config_email,
              &signals.npm_email, &signals.pip_email, &signals.vscode_sync_email,
              &signals.macos_contacts_email] {
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

    // ── 合并 OSINT 结果 ──
    let mut platforms: Vec<PlatformIdentity> = Vec::new();
    let mut bio_candidates: Vec<String> = Vec::new();
    let mut osint_name_candidates: Vec<String> = Vec::new();
    let mut osint_username_candidates: Vec<String> = Vec::new();
    let mut has_osint = false;

    if let Some(profile) = osint {
        has_osint = !profile.hits.is_empty();

        for hit in profile.found_hits() {
            let username = extract_username_from_url(&hit.url)
                .unwrap_or_else(|| hit.site.to_lowercase());

            if !usernames.contains(&username) {
                usernames.push(username.clone());
            }
            if !osint_username_candidates.contains(&username) {
                osint_username_candidates.push(username.clone());
            }

            platforms.push(PlatformIdentity {
                site: hit.site.clone(),
                username,
                url: hit.url.clone(),
                profile_name: hit.profile_name.clone(),
                profile_bio: hit.profile_bio.clone(),
            });

            if let Some(name) = &hit.profile_name {
                if !name.is_empty() && !osint_name_candidates.contains(name) {
                    osint_name_candidates.push(name.clone());
                }
            }
            if let Some(bio) = &hit.profile_bio {
                if !bio.is_empty() {
                    bio_candidates.push(bio.clone());
                }
            }
        }

        // 从最高置信度 cluster 取主身份
        if let Some(best_cluster) = profile.correlations.first() {
            for member in &best_cluster.members {
                if let Some(name) = &member.name {
                    if !name.is_empty() && !osint_name_candidates.contains(name) {
                        osint_name_candidates.insert(0, name.clone());
                    }
                }
            }
        }
    }

    // ── 确定最佳姓名 — 共识投票优先 ──
    // 优先级: consensus best_name (多源投票) > OSINT profile name > OS username
    let identity_name = consensus
        .best_name
        .clone()
        .or_else(|| osint_name_candidates.first().cloned())
        .or_else(|| signals.os_username.clone())
        .unwrap_or_default();

    // ── 合并 bio — 取最长/最详细的 ──
    let identity_bio = bio_candidates
        .iter()
        .max_by_key(|b| b.len())
        .cloned()
        .filter(|b| !b.is_empty());

    // ── 计算置信度 — 共识 + 交叉验证 + OSINT ──
    let confidence = calculate_confidence(&consensus, has_osint, osint);

    // ── 推断年龄 — 弱信号 ──
    let inferred_age = infer_age(signals);

    ComputedPersona {
        identity_name,
        identity_usernames: usernames,
        identity_emails: emails,
        identity_bio,
        identity_platforms: platforms,
        confidence,
        signal_sources,
        has_osint,
        is_fallback: false,
        inferred_age,
    }
}

/// 从 URL 路径推断 username — 取最后一个非空路径段。
fn extract_username_from_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|s| s.filter(|seg| !seg.is_empty()).collect())
        .unwrap_or_default();
    segments.last().map(|s| s.to_string())
}

/// 置信度计算 — 共识投票数 + 交叉验证 + OSINT 命中。
///
/// 维度权重:
///   - 共识投票: 每票 0.08，email/username/name 各最多 3 票 → 0.72
///   - 交叉验证 (email 本地部分 == username): +0.15
///   - OSINT 命中: 每命中 0.03，最多 +0.3
///   - 上限: 0.95（始终保留不确定性）
///   - 无 OSINT 时上限 0.5（本地信号再多也不如网络验证）
fn calculate_confidence(
    consensus: &SignalConsensus,
    has_osint: bool,
    osint: Option<&OsintProfile>,
) -> f32 {
    let email_score = (consensus.best_email_votes as f32 * 0.08).min(0.24);
    let username_score = (consensus.best_username_votes as f32 * 0.08).min(0.24);
    let name_score = (consensus.best_name_votes as f32 * 0.08).min(0.24);
    let cross_bonus = if consensus.cross_validated { 0.15 } else { 0.0 };

    let local_total = email_score + username_score + name_score + cross_bonus;

    if !has_osint {
        return local_total.min(0.5);
    }

    let osint_hits = osint.map(|o| o.positive_hit_count()).unwrap_or(0);
    let osint_score = (osint_hits as f32 * 0.03).min(0.3);

    (0.2 + local_total + osint_score).min(0.95)
}

/// 从弱信号推算年龄 — 家目录创建时间 / 首次 git commit。
///
/// ponytail: 只能给年龄下限。假设用户创建账户/首次 commit 时 16 岁。
/// 合理范围 10-80，超出则返回 None（→ 默认 21）。
/// 升级路径：OSINT bio 正则提取生日 → 精确年龄。
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