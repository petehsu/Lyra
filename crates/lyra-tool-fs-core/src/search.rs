use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use crate::model::ToolManifest;
use crate::scene::{ToolScene, pinned_handle_names, scene_domain_order};

pub(crate) struct ScoredToolManifest {
    pub(crate) manifest: ToolManifest,
    pub(crate) score: f64,
    pub(crate) matched_fields: Vec<String>,
    pub(crate) match_reason: String,
}

pub(crate) fn score_manifest_search(
    manifest: &ToolManifest,
    query: &str,
    scene: ToolScene,
    usage_boosts: &BTreeMap<String, f64>,
) -> Option<ScoredToolManifest> {
    let normalized_query = normalize_search_text(query);
    let query_terms = search_terms(query);
    if normalized_query.is_empty() || query_terms.is_empty() {
        return None;
    }
    let mut score = 0.0_f64;
    let mut matched_fields = Vec::new();
    let mut reasons = Vec::new();
    for field in searchable_manifest_fields(manifest) {
        let field_score = score_search_field(&normalized_query, &query_terms, &field);
        if field_score <= 0.0 {
            continue;
        }
        score += field_score * field.weight;
        if !matched_fields.iter().any(|name| name == field.name) {
            matched_fields.push(field.name.to_string());
        }
        if let Some(reason) = field.reason(field_score) {
            reasons.push(reason);
        }
    }
    if manifest
        .handle
        .as_deref()
        .is_some_and(|handle| normalize_search_text(handle) == normalized_query)
    {
        score += 40.0;
        reasons.push("exact handle match".to_string());
    }
    if normalize_search_text(&manifest.path) == normalized_query {
        score += 42.0;
        reasons.push("exact path match".to_string());
    }
    let intent_adjustment = search_intent_adjustment(manifest, query, &normalized_query);
    if intent_adjustment.score != 0.0 {
        score += intent_adjustment.score;
        reasons.push(intent_adjustment.reason);
    }
    if score <= 0.0 {
        return None;
    }
    if scene_domain_order(scene)
        .first()
        .is_some_and(|domain| *domain == manifest.domain)
    {
        score += 4.0;
    } else if scene_domain_order(scene)
        .iter()
        .any(|domain| *domain == manifest.domain)
    {
        score += 2.0;
    }
    if let Some(handle) = manifest.handle.as_deref()
        && pinned_handle_names(scene)
            .iter()
            .any(|pinned| *pinned == handle)
    {
        score += 6.0;
    }
    if let Some(boost) = usage_boosts.get(&manifest.path) {
        score += boost.clamp(0.0, 18.0);
        if *boost > 0.0 {
            reasons.push("recent successful usage".to_string());
        }
    }
    if score < 0.5 {
        return None;
    }
    if reasons.is_empty() {
        reasons.push("matched searchable tool metadata".to_string());
    }
    Some(ScoredToolManifest {
        manifest: manifest.clone(),
        score,
        matched_fields,
        match_reason: reasons.join("; "),
    })
}

#[derive(Clone, Debug, Default)]
struct IntentAdjustment {
    score: f64,
    reason: String,
}

fn search_intent_adjustment(
    manifest: &ToolManifest,
    raw_query: &str,
    normalized_query: &str,
) -> IntentAdjustment {
    let query = raw_query.to_lowercase();
    let path = manifest.path.as_str();
    let operation = manifest.operation.as_str();
    let title = manifest.title.to_lowercase();

    if is_design_quality_intent(&query, normalized_query) {
        if path == "/tools/design/quality" {
            return IntentAdjustment {
                score: 58.0,
                reason: "design-quality-audit intent boost".to_string(),
            };
        }
        if path == "/tools/design/extract_reference" {
            return IntentAdjustment {
                score: 14.0,
                reason: "rendered-design-evidence fallback".to_string(),
            };
        }
    }

    if is_design_reference_extraction_intent(&query, normalized_query) {
        if path == "/tools/design/extract_reference" {
            return IntentAdjustment {
                score: 54.0,
                reason: "design-reference-extraction intent boost".to_string(),
            };
        }
        if path == "/tools/design/reference" {
            return IntentAdjustment {
                score: 30.0,
                reason: "design-reference fallback intent boost".to_string(),
            };
        }
        if path == "/tools/browser/see" {
            return IntentAdjustment {
                score: -32.0,
                reason: "design-reference intent penalty for visual-only screenshot".to_string(),
            };
        }
    }

    if is_public_web_fetch_intent(&query, normalized_query) && path == "/tools/web/fetch" {
        return IntentAdjustment {
            score: 36.0,
            reason: "public-web-fetch intent boost".to_string(),
        };
    }

    if is_open_url_intent(&query, normalized_query) {
        if is_browser_navigate_tool(path, operation) || is_software_open_url_tool(path, &title) {
            return IntentAdjustment {
                score: 32.0,
                reason: "open-url intent boost".to_string(),
            };
        }
        if is_browser_act_tool(path, operation) || is_page_search_tool(path, operation) {
            return IntentAdjustment {
                score: -24.0,
                reason: "open-url intent penalty".to_string(),
            };
        }
    }

    if is_web_research_intent(&query, normalized_query) {
        if path == "/tools/web/research" {
            return IntentAdjustment {
                score: 34.0,
                reason: "web-research intent boost".to_string(),
            };
        }
    }

    if is_public_platform_search_intent(&query, normalized_query) {
        if path == "/tools/web/search" {
            return IntentAdjustment {
                score: 44.0,
                reason: "public-platform-search intent boost".to_string(),
            };
        }
        if path.starts_with("/tools/codegraph/") || path.starts_with("/tools/code/") {
            return IntentAdjustment {
                score: -20.0,
                reason: "public-platform-search intent penalty for code tools".to_string(),
            };
        }
    }

    if is_web_search_intent(&query, normalized_query)
        || is_public_platform_search_intent(&query, normalized_query)
    {
        if is_software_browser_search_tool(path) || path == "/tools/web/search" {
            return IntentAdjustment {
                score: 30.0,
                reason: "web-search intent boost".to_string(),
            };
        }
        if is_page_search_tool(path, operation) {
            return IntentAdjustment {
                score: -28.0,
                reason: "web-search intent penalty for page-find tools".to_string(),
            };
        }
    }

    if is_page_search_intent(&query, normalized_query) {
        if is_page_search_tool(path, operation) {
            return IntentAdjustment {
                score: 26.0,
                reason: "page-search intent boost".to_string(),
            };
        }
        if is_software_browser_search_tool(path) || path == "/tools/web/search" {
            return IntentAdjustment {
                score: -18.0,
                reason: "page-search intent penalty for web search".to_string(),
            };
        }
    }

    if is_semantic_locate_intent(&query, normalized_query) && path == "/tools/browser/locate" {
        return IntentAdjustment {
            score: 24.0,
            reason: "semantic-locate intent boost".to_string(),
        };
    }

    if is_browser_judge_intent(&query, normalized_query) && path == "/tools/browser/judge_task" {
        return IntentAdjustment {
            score: 22.0,
            reason: "browser-judge intent boost".to_string(),
        };
    }

    if is_web_crawl_intent(&query, normalized_query)
        && matches!(path, "/tools/web/map" | "/tools/web/batch")
    {
        return IntentAdjustment {
            score: 28.0,
            reason: "web-crawl intent boost".to_string(),
        };
    }

    if is_browser_interact_intent(&query, normalized_query) && path == "/tools/browser/interact" {
        return IntentAdjustment {
            score: 30.0,
            reason: "browser-interact intent boost".to_string(),
        };
    }

    if is_browser_interact_intent(&query, normalized_query)
        && matches!(
            path,
            "/tools/browser/navigate" | "/tools/browser/wait" | "/tools/browser/act"
        )
    {
        return IntentAdjustment {
            score: -16.0,
            reason: "browser-interact intent penalty for single-step tools".to_string(),
        };
    }

    if is_code_file_search_intent(&query, normalized_query) {
        if path.starts_with("/tools/code/") || path.starts_with("/tools/codegraph/") {
            return IntentAdjustment {
                score: 40.0,
                reason: "code-file-search intent boost".to_string(),
            };
        }
        if path.starts_with("/tools/filesystem/") {
            return IntentAdjustment {
                score: -80.0,
                reason: "code-file-search intent penalty for filesystem tools".to_string(),
            };
        }
    }

    if is_bounded_shell_intent(&query, normalized_query) {
        if path == "/tools/shell/run" {
            return IntentAdjustment {
                score: 44.0,
                reason: "bounded-shell intent boost".to_string(),
            };
        }
        if path == "/tools/terminal/run" {
            return IntentAdjustment {
                score: -18.0,
                reason: "bounded-shell intent penalty for terminal run".to_string(),
            };
        }
    }

    if is_interactive_terminal_intent(&query, normalized_query)
        && path.starts_with("/tools/terminal/")
    {
        return IntentAdjustment {
            score: 24.0,
            reason: "interactive-terminal intent boost".to_string(),
        };
    }

    if is_computer_use_intent(&query, normalized_query) && path.starts_with("/tools/computer/") {
        let score = match operation {
            "list_apps" | "observe" | "map" | "find" => 28.0,
            "act" | "focus" => 22.0,
            _ => 12.0,
        };
        return IntentAdjustment {
            score,
            reason: "computer-use intent boost".to_string(),
        };
    }

    if is_memory_intent(&query, normalized_query) && path.starts_with("/tools/memory/") {
        let score = match operation {
            "search" | "list" | "explain_injection" => 28.0,
            "remember" | "update" | "forget" => 18.0,
            _ => 12.0,
        };
        return IntentAdjustment {
            score,
            reason: "memory intent boost".to_string(),
        };
    }

    IntentAdjustment::default()
}

fn is_bounded_shell_intent(query: &str, normalized_query: &str) -> bool {
    if is_interactive_terminal_intent(query, normalized_query) {
        return false;
    }
    normalized_query.contains("run command")
        || normalized_query.contains("execute command")
        || normalized_query.contains("shell command")
        || normalized_query.contains("run test")
        || normalized_query.contains("run tests")
        || normalized_query.contains("run build")
        || normalized_query.contains("list directory")
        || normalized_query.contains("show files")
        || normalized_query.contains("pwd")
        || normalized_query.contains("ls ")
        || normalized_query.contains("git ")
        || normalized_query.contains("npm ")
        || normalized_query.contains("cargo ")
        || query.contains("跑测试")
        || query.contains("执行命令")
        || query.contains("运行命令")
        || query.contains("查看目录")
        || query.contains("列目录")
}

fn is_design_reference_extraction_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("design reference")
        || normalized_query.contains("design tokens")
        || normalized_query.contains("visual style")
        || normalized_query.contains("computed style")
        || normalized_query.contains("getcomputedstyle")
        || normalized_query.contains("extract style")
        || normalized_query.contains("extract colors")
        || normalized_query.contains("extract color")
        || normalized_query.contains("typography")
        || normalized_query.contains("spacing")
        || normalized_query.contains("bounds")
        || normalized_query.contains("area ratio")
        || normalized_query.contains("clone website")
        || normalized_query.contains("website clone")
        || query.contains("设计参考")
        || query.contains("提取设计")
        || query.contains("网站风格")
        || query.contains("视觉风格")
        || query.contains("设计 token")
        || query.contains("颜色")
        || query.contains("字体")
        || query.contains("间距")
        || query.contains("占用面积")
        || query.contains("面积")
        || query.contains("克隆网站")
        || query.contains("仿站")
        || query.contains("样式")
}

fn is_design_quality_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("design quality")
        || normalized_query.contains("design audit")
        || normalized_query.contains("ui review")
        || normalized_query.contains("ux review")
        || normalized_query.contains("ai slop")
        || normalized_query.contains("template-like")
        || normalized_query.contains("frontend quality")
        || normalized_query.contains("accessibility review")
        || query.contains("设计审查")
        || query.contains("界面审查")
        || query.contains("设计质量")
        || query.contains("前端质量")
        || query.contains("模板化")
        || query.contains("ai 味")
        || query.contains("可访问性审查")
}

fn is_interactive_terminal_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("interactive terminal")
        || normalized_query.contains("terminal session")
        || normalized_query.contains("existing terminal")
        || normalized_query.contains("read terminal")
        || normalized_query.contains("terminal output")
        || normalized_query.contains("terminal pane")
        || normalized_query.contains("long-running")
        || normalized_query.contains("background")
        || query.contains("交互式终端")
        || query.contains("终端会话")
        || query.contains("读取终端")
        || query.contains("终端输出")
        || query.contains("终端面板")
        || query.contains("后台")
        || query.contains("长运行")
        || query.contains("长时间运行")
}

fn is_computer_use_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("computer")
        || normalized_query.contains("desktop")
        || normalized_query.contains("window")
        || normalized_query.contains("native app")
        || normalized_query.contains("application")
        || normalized_query.contains("accessibility")
        || query.contains("电脑")
        || query.contains("桌面")
        || query.contains("窗口")
        || query.contains("应用")
        || query.contains("软件")
}

fn is_memory_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("memory")
        || normalized_query.contains("remember")
        || normalized_query.contains("preference")
        || normalized_query.contains("stored fact")
        || query.contains("记忆")
        || query.contains("偏好")
        || query.contains("记住")
        || query.contains("长期记忆")
}

fn is_web_crawl_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("crawl")
        || normalized_query.contains("whole site")
        || normalized_query.contains("all pages")
        || normalized_query.contains("batch fetch")
        || normalized_query.contains("map site")
        || normalized_query.contains("discover urls")
        || query.contains("整站")
        || query.contains("批量抓取")
        || query.contains("发现链接")
}

fn is_browser_interact_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("click then read")
        || normalized_query.contains("operate then")
        || normalized_query.contains("after clicking")
        || normalized_query.contains("navigate wait")
        || normalized_query.contains("browser operation")
        || normalized_query.contains("operate browser")
        || query.contains("先操作")
        || query.contains("操作后读取")
        || query.contains("点击后读取")
        || query.contains("浏览器操作")
        || query.contains("操作浏览器")
}

fn is_code_file_search_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("search code")
        || normalized_query.contains("read file")
        || normalized_query.contains("find file")
        || normalized_query.contains("grep code")
        || query.contains("查文件")
        || query.contains("搜索代码")
        || query.contains("修改文件")
}

fn is_open_url_intent(query: &str, normalized_query: &str) -> bool {
    query.contains("http://")
        || query.contains("https://")
        || query.contains("www.")
        || normalized_query.contains("open url")
        || normalized_query.contains("go to url")
        || normalized_query.contains("navigate url")
        || normalized_query.contains("open website")
        || normalized_query.contains("open webpage")
        || normalized_query.contains("visit site")
        || query.contains("打开网页")
        || query.contains("打开网站")
        || query.contains("进入网站")
        || query.contains("访问网址")
        || query.contains("跳转网址")
}

fn is_web_search_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("google search")
        || normalized_query.contains("search google")
        || normalized_query.contains("browser search google")
        || normalized_query.contains("web search")
        || normalized_query.contains("internet search")
        || normalized_query.contains("search the web")
        || query.contains("全网搜索")
        || query.contains("联网搜索")
        || query.contains("用google搜索")
        || query.contains("google搜索")
        || query.contains("谷歌搜索")
        || query.contains("搜索一下")
        || query.contains("搜一下")
}

fn is_web_research_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("research")
        || normalized_query.contains("deep read")
        || normalized_query.contains("read top")
        || normalized_query.contains("what people think")
        || normalized_query.contains("community discussion")
        || query.contains("调研")
        || query.contains("网上讨论")
        || query.contains("大家怎么评价")
        || query.contains("大家怎么看")
        || query.contains("搜索并阅读")
        || query.contains("搜索并总结")
}

fn is_public_platform_search_intent(query: &str, normalized_query: &str) -> bool {
    has_public_platform_signal(query, normalized_query)
        && (normalized_query.contains("search")
            || query.contains("搜索")
            || query.contains("搜")
            || query.contains("查")
            || query.contains("找"))
}

fn is_public_web_fetch_intent(query: &str, normalized_query: &str) -> bool {
    let feed_intent = normalized_query.contains("rss")
        || normalized_query.contains("atom")
        || normalized_query.contains("feed")
        || query.contains("订阅");
    let read_intent = normalized_query.contains("read")
        || normalized_query.contains("fetch")
        || normalized_query.contains("summarize")
        || normalized_query.contains("summary")
        || normalized_query.contains("what does")
        || normalized_query.contains("transcript")
        || query.contains("读")
        || query.contains("读取")
        || query.contains("看一下")
        || query.contains("看看")
        || query.contains("总结")
        || query.contains("讲了什么")
        || query.contains("内容");
    let v2ex_public_list = query.contains("v2ex")
        && (query.contains("热门") || query.contains("帖子") || normalized_query.contains("topic"));

    feed_intent
        || v2ex_public_list
        || ((query.contains("http://")
            || query.contains("https://")
            || query.contains("www.")
            || has_public_platform_signal(query, normalized_query))
            && read_intent
            && !is_public_platform_search_intent(query, normalized_query))
}

fn has_public_platform_signal(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("github")
        || normalized_query.contains("youtube")
        || normalized_query.contains("bilibili")
        || normalized_query.contains("v2ex")
        || query.contains("b站")
        || query.contains("哔哩")
}

fn is_page_search_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("search in page")
        || normalized_query.contains("find in page")
        || normalized_query.contains("find current page")
        || normalized_query.contains("search current page")
        || normalized_query.contains("page search")
        || query.contains("页内搜索")
        || query.contains("页面搜索")
        || query.contains("当前页面查找")
        || query.contains("搜索当前页")
        || query.contains("搜索当前网页")
        || query.contains("查找页面")
}

fn is_semantic_locate_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("semantic locate")
        || normalized_query.contains("locate section")
        || normalized_query.contains("locate text")
        || normalized_query.contains("nearby controls")
        || query.contains("语义定位")
        || query.contains("定位页面")
        || query.contains("定位文本")
        || query.contains("附近控件")
}

fn is_browser_judge_intent(query: &str, normalized_query: &str) -> bool {
    normalized_query.contains("judge browser")
        || normalized_query.contains("verify browser task")
        || normalized_query.contains("browser task complete")
        || normalized_query.contains("task completion")
        || query.contains("浏览器任务验收")
        || query.contains("任务完成判断")
        || query.contains("验收浏览器")
}

fn is_browser_navigate_tool(path: &str, operation: &str) -> bool {
    path == "/tools/browser/navigate"
        || (path.starts_with("/tools/browser/") && operation == "navigate")
}

fn is_software_open_url_tool(path: &str, title: &str) -> bool {
    let path = path.to_lowercase();
    path.ends_with(".openurl")
        || path.ends_with(".open_url")
        || path.ends_with("/openurl")
        || title == "open url"
}

fn is_browser_act_tool(path: &str, operation: &str) -> bool {
    path == "/tools/browser/act" || (path.starts_with("/tools/browser/") && operation == "act")
}

fn is_page_search_tool(path: &str, operation: &str) -> bool {
    let path = path.to_lowercase();
    path == "/tools/browser/find"
        || path == "/tools/browser/locate"
        || path.ends_with(".searchinpage")
        || operation == "find"
        || operation == "locate"
}

fn is_software_browser_search_tool(path: &str) -> bool {
    let path = path.to_lowercase();
    path.ends_with("browser-search.search")
        || path.ends_with("browser-search/browser-search.search")
}

#[derive(Clone, Debug)]
struct SearchableField {
    name: &'static str,
    text: String,
    weight: f64,
}

impl SearchableField {
    fn reason(&self, score: f64) -> Option<String> {
        if score >= 1.8 {
            Some(format!("strong {} match", self.name))
        } else if score >= 1.0 {
            Some(format!("{} token match", self.name))
        } else if score > 0.0 {
            Some(format!("{} fuzzy match", self.name))
        } else {
            None
        }
    }
}

fn searchable_manifest_fields(manifest: &ToolManifest) -> Vec<SearchableField> {
    vec![
        SearchableField {
            name: "path",
            text: manifest.path.clone(),
            weight: 20.0,
        },
        SearchableField {
            name: "handle",
            text: manifest.handle.clone().unwrap_or_default(),
            weight: 18.0,
        },
        SearchableField {
            name: "title",
            text: manifest.title.clone(),
            weight: 16.0,
        },
        SearchableField {
            name: "aliases",
            text: manifest.aliases.join(" "),
            weight: 14.0,
        },
        SearchableField {
            name: "examples",
            text: manifest.examples.join(" "),
            weight: 12.0,
        },
        SearchableField {
            name: "summary",
            text: manifest.summary.clone(),
            weight: 10.0,
        },
        SearchableField {
            name: "description",
            text: manifest.description.clone(),
            weight: 9.0,
        },
        SearchableField {
            name: "tags",
            text: manifest.tags.join(" "),
            weight: 7.0,
        },
        SearchableField {
            name: "schema",
            text: schema_search_text(&manifest.input_schema),
            weight: 4.0,
        },
    ]
}

fn score_search_field(
    normalized_query: &str,
    query_terms: &[String],
    field: &SearchableField,
) -> f64 {
    let normalized_field = normalize_search_text(&field.text);
    if normalized_field.is_empty() {
        return 0.0;
    }
    if normalized_field == normalized_query {
        return 2.8;
    }
    if normalized_field.starts_with(normalized_query) {
        return 2.2;
    }
    if normalized_field.contains(normalized_query) {
        return 1.8;
    }
    let field_terms = search_terms(&normalized_field);
    if field_terms.is_empty() {
        return 0.0;
    }
    let mut exact = 0_usize;
    let mut prefix = 0_usize;
    let mut fuzzy = 0_usize;
    for term in query_terms {
        if field_terms.iter().any(|candidate| candidate == term) {
            exact += 1;
        } else if field_terms
            .iter()
            .any(|candidate| candidate.starts_with(term) || term.starts_with(candidate))
        {
            prefix += 1;
        } else if field_terms
            .iter()
            .any(|candidate| fuzzy_term_match(term, candidate))
        {
            fuzzy += 1;
        }
    }
    let total = query_terms.len().max(1) as f64;
    (exact as f64 / total) * 1.35 + (prefix as f64 / total) * 1.0 + (fuzzy as f64 / total) * 0.55
}

pub(crate) fn best_fallback_list_path(
    query: &str,
    manifests: &[ToolManifest],
    scene: ToolScene,
) -> String {
    let query_terms = search_terms(query);
    let mut domain_scores = HashMap::<String, f64>::new();
    for manifest in manifests {
        let text = format!(
            "{} {} {} {} {}",
            manifest.domain,
            manifest.title,
            manifest.summary,
            manifest.description,
            manifest.tags.join(" ")
        );
        let terms = search_terms(&text);
        let matched = query_terms
            .iter()
            .filter(|query| {
                terms
                    .iter()
                    .any(|term| term == *query || fuzzy_term_match(query, term))
            })
            .count();
        if matched > 0 {
            *domain_scores.entry(manifest.domain.clone()).or_default() += matched as f64;
        }
    }
    if let Some((domain, _)) = domain_scores.into_iter().max_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    }) {
        return format!("/tools/{domain}");
    }
    scene_domain_order(scene)
        .first()
        .map(|domain| format!("/tools/{domain}"))
        .unwrap_or_else(|| "/tools".to_string())
}

fn schema_search_text(schema: &Value) -> String {
    let mut values = Vec::new();
    collect_schema_search_text(schema, &mut values);
    values.join(" ")
}

fn collect_schema_search_text(value: &Value, values: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if matches!(
                    key.as_str(),
                    "description" | "title" | "default" | "enum" | "properties" | "required"
                ) {
                    values.push(key.clone());
                }
                if key != "$id" {
                    values.push(key.clone());
                    collect_schema_search_text(value, values);
                }
            }
        }
        Value::Array(array) => {
            for value in array {
                collect_schema_search_text(value, values);
            }
        }
        Value::String(text) => values.push(text.clone()),
        Value::Bool(_) | Value::Number(_) | Value::Null => {}
    }
}

fn normalize_search_text(text: &str) -> String {
    text.to_lowercase()
        .replace(['_', '-', '/', '.', ':'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn search_terms(text: &str) -> Vec<String> {
    normalize_search_text(text)
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 2)
        .map(str::to_string)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}

fn fuzzy_term_match(query: &str, candidate: &str) -> bool {
    let query_len = query.chars().count();
    let candidate_len = candidate.chars().count();
    if query_len < 4 || candidate_len < 4 {
        return false;
    }
    let delta = query_len.abs_diff(candidate_len);
    let max_distance = if query_len.max(candidate_len) >= 8 {
        2
    } else {
        1
    };
    delta <= max_distance && levenshtein_distance(query, candidate, max_distance) <= max_distance
}

fn levenshtein_distance(left: &str, right: &str, max_distance: usize) -> usize {
    let left_chars = left.chars().collect::<Vec<_>>();
    let right_chars = right.chars().collect::<Vec<_>>();
    if left_chars.len().abs_diff(right_chars.len()) > max_distance {
        return max_distance + 1;
    }
    let mut previous = (0..=right_chars.len()).collect::<Vec<_>>();
    let mut current = vec![0; right_chars.len() + 1];
    for (left_index, left_char) in left_chars.iter().enumerate() {
        current[0] = left_index + 1;
        let mut row_min = current[0];
        for (right_index, right_char) in right_chars.iter().enumerate() {
            let cost = usize::from(left_char != right_char);
            current[right_index + 1] = (current[right_index] + 1)
                .min(previous[right_index + 1] + 1)
                .min(previous[right_index] + cost);
            row_min = row_min.min(current[right_index + 1]);
        }
        if row_min > max_distance {
            return max_distance + 1;
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right_chars.len()]
}

pub(crate) fn round_score(score: f64) -> f64 {
    (score * 100.0).round() / 100.0
}
