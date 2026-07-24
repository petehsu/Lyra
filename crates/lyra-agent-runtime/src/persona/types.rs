use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// 本地信号采集结果 — 纯本地操作，无网络请求。
///
/// 20 个信号维度，覆盖 OS / Git / SSH / 包管理器 / 编辑器 / 浏览器 / 系统通讯录。
/// 种子选择不使用固定优先级链，而是通过 `build_consensus()` 做多源投票。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalBundle {
    // ── OS 层 ──
    pub os_username: Option<String>,
    pub os_full_name: Option<String>,
    pub hostname: Option<String>,

    // ── Git 层 ──
    pub git_name: Option<String>,
    pub git_email: Option<String>,
    pub git_dominant_email: Option<String>,
    pub git_github_user: Option<String>,
    pub git_remote_usernames: Vec<String>,

    // ── SSH 层 ──
    pub ssh_key_comments: Vec<String>,
    pub ssh_known_hosts: Vec<String>,

    // ── 包管理器层 ──
    pub npm_email: Option<String>,
    pub pip_email: Option<String>,

    // ── 编辑器层 ──
    pub vscode_sync_email: Option<String>,

    // ── 浏览器自动填充 (desktop-side) ──
    pub browser_autofill_names: Vec<String>,
    pub browser_autofill_emails: Vec<String>,

    // ── 系统通讯录 (desktop-side, macOS) ──
    pub macos_contacts_name: Option<String>,
    pub macos_contacts_email: Option<String>,

    // ── Lyra 自身 ──
    pub lyra_config_email: Option<String>,

    // ── Desktop hints ──
    pub login_manager_hints: Vec<String>,

    // ── 年龄推断信号 (弱信号) ──
    /// 家目录创建时间 (epoch seconds) — macOS: `stat -f %B ~`
    pub home_dir_birthtime: Option<i64>,
    /// 首次 git commit 日期 (ISO8601) — `git log --format=%aI --all --reverse | head -1`
    pub git_first_commit_date: Option<String>,
}

/// 共识投票结果 — 多源交叉验证后的最佳候选。
///
/// 每个 `best_*` 字段是通过投票选出的值：
/// 出现在越多独立信号源中的值得票越高，得票最高的胜出。
/// `cross_validated` 表示 email 本地部分与最佳 username 一致 — 强身份信号。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalConsensus {
    pub best_email: Option<String>,
    pub best_email_votes: usize,
    pub best_email_sources: Vec<String>,

    pub best_username: Option<String>,
    pub best_username_votes: usize,
    pub best_username_sources: Vec<String>,

    pub best_name: Option<String>,
    pub best_name_votes: usize,
    pub best_name_sources: Vec<String>,

    /// email 本地部分 == 最佳 username → 交叉验证通过
    pub cross_validated: bool,

    /// 有贡献的独立信号源总数
    pub total_sources: usize,
}

impl SignalBundle {
    /// 构建共识 — 对 email / username / name 分别做多源投票。
    ///
    /// 投票规则: 每个独立信号源对某个值投一票。
    /// 同一值出现在越多源中 → 票数越高 → 胜出。
    /// 平票时按值字母序做确定性 tiebreak。
    pub fn build_consensus(&self) -> SignalConsensus {
        let email_votes = self.collect_email_votes();
        let (best_email, best_email_votes, best_email_sources) = pick_winner(&email_votes);

        let username_votes = self.collect_username_votes(&best_email);
        let (best_username, best_username_votes, best_username_sources) =
            pick_winner(&username_votes);

        let name_votes = self.collect_name_votes();
        let (best_name, best_name_votes, best_name_sources) = pick_winner(&name_votes);

        let cross_validated = match (&best_email, &best_username) {
            (Some(email), Some(username)) => {
                let local = email.split('@').next().unwrap_or("").to_lowercase();
                local == username.to_lowercase()
            }
            _ => false,
        };

        SignalConsensus {
            best_email,
            best_email_votes,
            best_email_sources,
            best_username,
            best_username_votes,
            best_username_sources,
            best_name,
            best_name_votes,
            best_name_sources,
            cross_validated,
            total_sources: self.source_labels().len(),
        }
    }

    /// 选出最适合作为 OSINT 扫描种子的值 — 基于共识投票。
    /// email 优先（可派生多个 username），其次 username。
    pub fn best_seed(&self) -> Option<String> {
        let c = self.build_consensus();
        c.best_email
            .as_deref()
            .or(c.best_username.as_deref())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
    }

    /// 所有非空信号源标签，用于置信度计算和 prompt 透明度。
    pub fn source_labels(&self) -> Vec<&'static str> {
        let mut labels = Vec::new();
        if self.os_username.is_some() {
            labels.push("os_username");
        }
        if self.os_full_name.is_some() {
            labels.push("os_full_name");
        }
        if self.hostname.is_some() {
            labels.push("hostname");
        }
        if self.git_name.is_some() {
            labels.push("git_name");
        }
        if self.git_email.is_some() {
            labels.push("git_email");
        }
        if self.git_dominant_email.is_some() {
            labels.push("git_dominant_email");
        }
        if self.git_github_user.is_some() {
            labels.push("git_github_user");
        }
        if !self.git_remote_usernames.is_empty() {
            labels.push("git_remote_usernames");
        }
        if !self.ssh_key_comments.is_empty() {
            labels.push("ssh_key_comments");
        }
        if !self.ssh_known_hosts.is_empty() {
            labels.push("ssh_known_hosts");
        }
        if self.npm_email.is_some() {
            labels.push("npm_email");
        }
        if self.pip_email.is_some() {
            labels.push("pip_email");
        }
        if self.vscode_sync_email.is_some() {
            labels.push("vscode_sync_email");
        }
        if !self.browser_autofill_names.is_empty() {
            labels.push("browser_autofill_names");
        }
        if !self.browser_autofill_emails.is_empty() {
            labels.push("browser_autofill_emails");
        }
        if self.macos_contacts_name.is_some() {
            labels.push("macos_contacts_name");
        }
        if self.macos_contacts_email.is_some() {
            labels.push("macos_contacts_email");
        }
        if self.lyra_config_email.is_some() {
            labels.push("lyra_config_email");
        }
        if !self.login_manager_hints.is_empty() {
            labels.push("login_manager_hints");
        }
        if self.home_dir_birthtime.is_some() {
            labels.push("home_dir_birthtime");
        }
        if self.git_first_commit_date.is_some() {
            labels.push("git_first_commit_date");
        }
        labels
    }

    /// 从 email 本地部分 + git/github 用户名 + OS 用户名派生 username 候选。
    pub fn username_candidates(&self) -> Vec<String> {
        let mut candidates = Vec::new();

        // 从所有 email 源派生
        let emails: Vec<&String> = [
            self.git_email.as_ref(),
            self.git_dominant_email.as_ref(),
            self.lyra_config_email.as_ref(),
            self.npm_email.as_ref(),
            self.pip_email.as_ref(),
            self.vscode_sync_email.as_ref(),
            self.macos_contacts_email.as_ref(),
        ]
        .into_iter()
        .flatten()
        .collect();

        for email in &emails {
            let local = email.split('@').next().unwrap_or("").to_lowercase();
            if !local.is_empty() {
                let parts: Vec<&str> = local
                    .split(|c: char| c == '.' || c == '_' || c == '-' || c == '+')
                    .collect();
                push_unique(&mut candidates, &local);
                if parts.len() > 1 {
                    push_unique(&mut candidates, &parts.join(""));
                    push_unique(&mut candidates, &parts.join("_"));
                    push_unique(&mut candidates, &parts.join("."));
                    push_unique(&mut candidates, parts[0]);
                }
            }
        }

        // git github.user
        if let Some(u) = &self.git_github_user {
            push_unique(&mut candidates, &u.to_lowercase());
        }

        // git remote usernames
        for u in &self.git_remote_usernames {
            push_unique(&mut candidates, &u.to_lowercase());
        }

        // OS username
        if let Some(name) = &self.os_username {
            push_unique(&mut candidates, &name.to_lowercase());
        }

        // browser autofill emails
        for email in &self.browser_autofill_emails {
            let local = email.split('@').next().unwrap_or("").to_lowercase();
            if !local.is_empty() {
                push_unique(&mut candidates, &local);
            }
        }

        candidates.into_iter().filter(|c| c.len() >= 2).collect()
    }

    // ── 共识投票: 收集各维度的 (value, source) 票 ──

    fn collect_email_votes(&self) -> Vec<(String, &'static str)> {
        let mut votes = Vec::new();
        if let Some(e) = &self.git_email {
            votes.push((e.clone(), "git_config"));
        }
        if let Some(e) = &self.git_dominant_email {
            votes.push((e.clone(), "git_history"));
        }
        if let Some(e) = &self.lyra_config_email {
            votes.push((e.clone(), "lyra_config"));
        }
        if let Some(e) = &self.npm_email {
            votes.push((e.clone(), "npm"));
        }
        if let Some(e) = &self.pip_email {
            votes.push((e.clone(), "pip"));
        }
        if let Some(e) = &self.vscode_sync_email {
            votes.push((e.clone(), "vscode"));
        }
        if let Some(e) = &self.macos_contacts_email {
            votes.push((e.clone(), "contacts"));
        }
        for e in &self.browser_autofill_emails {
            votes.push((e.clone(), "autofill"));
        }
        votes
    }

    fn collect_username_votes(&self, best_email: &Option<String>) -> Vec<(String, &'static str)> {
        let mut votes = Vec::new();
        if let Some(u) = &self.git_github_user {
            votes.push((u.to_lowercase(), "git_github"));
        }
        for u in &self.git_remote_usernames {
            votes.push((u.to_lowercase(), "git_remote"));
        }
        if let Some(u) = &self.os_username {
            votes.push((u.to_lowercase(), "os_user"));
        }
        // 从最佳 email 派生 username
        if let Some(email) = best_email {
            let local = email.split('@').next().unwrap_or("").to_lowercase();
            if !local.is_empty() {
                votes.push((local, "email_derived"));
            }
        }
        // SSH key comment 中看起来像 username 或 email 本地部分
        for c in &self.ssh_key_comments {
            if c.contains('@') {
                if let Some(local) = c.split('@').next() {
                    let lower = local.to_lowercase();
                    if lower.len() >= 2 {
                        votes.push((lower, "ssh_comment"));
                    }
                }
            } else if c.len() >= 2 && !c.contains(' ') {
                votes.push((c.to_lowercase(), "ssh_comment"));
            }
        }
        votes
    }

    fn collect_name_votes(&self) -> Vec<(String, &'static str)> {
        let mut votes = Vec::new();
        if let Some(n) = &self.os_full_name {
            votes.push((n.clone(), "os_fullname"));
        }
        if let Some(n) = &self.git_name {
            votes.push((n.clone(), "git_name"));
        }
        if let Some(n) = &self.macos_contacts_name {
            votes.push((n.clone(), "contacts"));
        }
        for n in &self.browser_autofill_names {
            votes.push((n.clone(), "autofill"));
        }
        votes
    }
}

/// 投票计票: 按 value 分组，统计每个 value 的独立来源数。
/// 票数最高者胜出；平票时按 value 字母序做确定性 tiebreak。
fn pick_winner(votes: &[(String, &'static str)]) -> (Option<String>, usize, Vec<String>) {
    if votes.is_empty() {
        return (None, 0, Vec::new());
    }
    // key = value, val = (unique_source_count, source_names)
    let mut groups: HashMap<&str, (usize, Vec<&'static str>)> = HashMap::new();
    for (value, source) in votes {
        let entry = groups.entry(value.as_str()).or_insert((0, Vec::new()));
        if !entry.1.contains(source) {
            entry.0 += 1;
            entry.1.push(*source);
        }
    }
    let (value, (count, sources)) = groups
        .into_iter()
        .max_by(|a, b| a.1.0.cmp(&b.1.0).then_with(|| a.0.cmp(&b.0)))
        .expect("non-empty votes");
    (
        Some(value.to_string()),
        count,
        sources.into_iter().map(String::from).collect(),
    )
}

fn push_unique(vec: &mut Vec<String>, s: &str) {
    let s = s.to_string();
    if !vec.contains(&s) {
        vec.push(s);
    }
}

/// 单个 OSINT 扫描命中。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsintHit {
    pub site: String,
    pub url: String,
    /// "Found" / "Maybe" / "Not Found" / "Error"
    pub status: String,
    /// 0-100 置信度
    pub confidence: u8,
    pub profile_name: Option<String>,
    pub profile_bio: Option<String>,
    pub profile_avatar: Option<String>,
}

/// 跨平台关联聚类 — "可能是同一个人"的站点群。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsintCluster {
    pub size: usize,
    pub reasons: Vec<String>,
    pub members: Vec<ClusterMember>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterMember {
    pub site: String,
    pub username: String,
    pub url: String,
    pub name: Option<String>,
    pub bio: Option<String>,
}

/// OSINT 扫描完整结果。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsintProfile {
    pub seed: String,
    pub hits: Vec<OsintHit>,
    pub correlations: Vec<OsintCluster>,
    pub expanded_usernames: Vec<String>,
    pub scan_timestamp: String,
    /// 扫描是否未完成（超时/Python 缺失等）
    pub scan_incomplete: bool,
}

impl OsintProfile {
    /// 只保留 Found 状态的命中。
    pub fn found_hits(&self) -> impl Iterator<Item = &OsintHit> {
        self.hits.iter().filter(|h| h.status == "Found")
    }

    /// Found + Maybe 命中数。
    pub fn positive_hit_count(&self) -> usize {
        self.hits
            .iter()
            .filter(|h| h.status == "Found" || h.status == "Maybe")
            .count()
    }
}

/// 单个平台的身份信息。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformIdentity {
    pub site: String,
    pub username: String,
    pub url: String,
    pub profile_name: Option<String>,
    pub profile_bio: Option<String>,
}

/// PersonaEngine 的最终输出 — 注入 prompt 的计算后身份。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedPersona {
    /// 最佳推断的真实姓名
    pub identity_name: String,
    /// 各平台用户名
    pub identity_usernames: Vec<String>,
    /// 各 email 来源
    pub identity_emails: Vec<String>,
    /// 合并的 bio（取最长/最详细的）
    pub identity_bio: Option<String>,
    /// 各平台身份（Found 状态）
    pub identity_platforms: Vec<PlatformIdentity>,
    /// 整体置信度 0.0-1.0
    pub confidence: f32,
    /// 哪些信号源被使用
    pub signal_sources: Vec<String>,
    /// 是否包含 OSINT 结果
    pub has_osint: bool,
    /// 是否为降级 — 无任何信号时 identity_name 为空
    pub is_fallback: bool,
    /// 推断的年龄 — 弱信号推算，None 时用默认 21
    pub inferred_age: Option<u32>,
}

impl ComputedPersona {
    /// 降级 — 完全无信号时使用。
    /// identity_name 为空，不渲染名字行；年龄/地点/存在时长仍可渲染。
    pub fn fallback_lyra() -> Self {
        Self {
            identity_name: String::new(),
            identity_usernames: Vec::new(),
            identity_emails: Vec::new(),
            identity_bio: None,
            identity_platforms: Vec::new(),
            confidence: 0.0,
            signal_sources: Vec::new(),
            has_osint: false,
            is_fallback: true,
            inferred_age: None,
        }
    }

    /// 降级到只有 OS username 的最小 persona。
    pub fn fallback_username_only(username: &str) -> Self {
        Self {
            identity_name: username.to_string(),
            identity_usernames: vec![username.to_string()],
            identity_emails: Vec::new(),
            identity_bio: None,
            identity_platforms: Vec::new(),
            confidence: 0.1,
            signal_sources: vec!["os_username".to_string()],
            has_osint: false,
            is_fallback: false,
            inferred_age: None,
        }
    }

    /// 是否有足够的身份信息来注入 kernel 身份渲染。
    pub fn has_identity(&self) -> bool {
        !self.identity_name.is_empty()
    }
}
