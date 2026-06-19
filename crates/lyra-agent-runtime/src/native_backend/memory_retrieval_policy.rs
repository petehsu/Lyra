use super::*;
use crate::native_backend::memory_store::SYSTEM_RECALL_LIMIT;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RetrievalDomain {
    Session,
    Project,
    Shared,
    Archive,
}

impl RetrievalDomain {
    fn label(self) -> &'static str {
        match self {
            Self::Session => "session",
            Self::Project => "project",
            Self::Shared => "shared",
            Self::Archive => "archive",
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct RetrievalExpansionPlan {
    pub domains_used: Vec<String>,
    pub top_score: f64,
    pub selected_count: usize,
}

const MIN_RECALL_COUNT: usize = 2;
const MIN_RECALL_TOP_SCORE: f64 = 0.30;
const MIN_MEMORY_TOP_SCORE: f64 = 0.22;
const SHARED_INJECTION_QUOTA: usize = 5;
const FROZEN_INJECTION_QUOTA: usize = 3;

pub(crate) fn expand_long_term_memory_injection(
    root: &Path,
    latest_user_text: &str,
    working_dir: Option<&str>,
    limit: usize,
) -> AgentRuntimeResult<(Vec<RankedMemoryRecord>, RetrievalExpansionPlan)> {
    let query = [Some(latest_user_text), working_dir]
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let query_opt = (!query.trim().is_empty()).then_some(query.as_str());
    let mut domains_used = Vec::new();
    let mut selected = Vec::new();

    if working_dir.is_some() {
        let project = search_ranked_long_term_memory(
            root,
            MemoryQuery {
                query: query_opt.map(str::to_string),
                scope: Some("project".to_string()),
                include_archived: false,
                include_related: true,
                touch_access: true,
                access_type: "context_injection".to_string(),
                limit,
                ..MemoryQuery::default()
            },
        )?
        .into_iter()
        .filter(|ranked| ranked.breakdown.contradiction_penalty <= f64::EPSILON)
        .collect::<Vec<_>>();
        if !project.is_empty() {
            domains_used.push(RetrievalDomain::Project.label().to_string());
            selected = project;
        }
    }

    if !memory_retrieval_sufficient(&selected, MIN_MEMORY_TOP_SCORE, 1) {
        let shared_quota = limit.min(SHARED_INJECTION_QUOTA);
        let shared = search_ranked_long_term_memory(
            root,
            MemoryQuery {
                query: query_opt.map(str::to_string),
                scope: Some("global".to_string()),
                layer: Some(LAYER_SHARED.to_string()),
                include_archived: false,
                include_related: true,
                touch_access: true,
                access_type: "context_injection".to_string(),
                limit: shared_quota,
                ..MemoryQuery::default()
            },
        )?
        .into_iter()
        .filter(|ranked| ranked.breakdown.contradiction_penalty <= f64::EPSILON)
        .collect::<Vec<_>>();
        if !shared.is_empty() {
            domains_used.push(RetrievalDomain::Shared.label().to_string());
            merge_ranked_memory(&mut selected, shared, limit);
        }
        let frozen_quota = limit
            .saturating_sub(selected.len())
            .min(FROZEN_INJECTION_QUOTA);
        if frozen_quota > 0 {
            let frozen = search_ranked_long_term_memory(
                root,
                MemoryQuery {
                    query: query_opt.map(str::to_string),
                    scope: Some("global".to_string()),
                    layer: Some(LAYER_FROZEN.to_string()),
                    include_archived: false,
                    include_related: true,
                    touch_access: true,
                    access_type: "context_injection".to_string(),
                    limit: frozen_quota,
                    ..MemoryQuery::default()
                },
            )?
            .into_iter()
            .filter(|ranked| ranked.breakdown.contradiction_penalty <= f64::EPSILON)
            .collect::<Vec<_>>();
            if !frozen.is_empty() {
                domains_used.push("frozen".to_string());
                merge_ranked_memory(&mut selected, frozen, limit);
            }
        }
    }

    let top_score = selected.first().map(|entry| entry.score).unwrap_or(0.0);
    let selected_count = selected.len();
    Ok((
        selected,
        RetrievalExpansionPlan {
            domains_used,
            top_score,
            selected_count,
        },
    ))
}

pub(crate) fn expand_system_recall_injection(
    ranked: Vec<RankedSystemRecallItem>,
    session_id: &str,
    project_memory_ids: &HashSet<String>,
) -> (Vec<RankedSystemRecallItem>, RetrievalExpansionPlan) {
    let mut domains_used = Vec::new();
    let session_items: Vec<_> = ranked
        .iter()
        .filter(|entry| {
            recall_item_in_domain(
                &entry.item,
                session_id,
                project_memory_ids,
                RetrievalDomain::Session,
            )
        })
        .cloned()
        .collect();
    let mut selected = dedupe_and_budget_recall(session_items);
    if recall_retrieval_sufficient(&selected, MIN_RECALL_TOP_SCORE, MIN_RECALL_COUNT) {
        domains_used.push(RetrievalDomain::Session.label().to_string());
        let plan = plan_from(&selected, domains_used);
        return (selected, plan);
    }

    let project_items: Vec<_> = ranked
        .iter()
        .filter(|entry| {
            recall_item_in_domain(
                &entry.item,
                session_id,
                project_memory_ids,
                RetrievalDomain::Project,
            )
        })
        .cloned()
        .collect();
    domains_used.push(RetrievalDomain::Project.label().to_string());
    merge_ranked_recall(&mut selected, dedupe_and_budget_recall(project_items));

    if recall_retrieval_sufficient(&selected, MIN_RECALL_TOP_SCORE, MIN_RECALL_COUNT) {
        let plan = plan_from(&selected, domains_used);
        return (selected, plan);
    }

    let shared_items: Vec<_> = ranked
        .iter()
        .filter(|entry| {
            recall_item_in_domain(
                &entry.item,
                session_id,
                project_memory_ids,
                RetrievalDomain::Shared,
            )
        })
        .cloned()
        .collect();
    if !shared_items.is_empty() {
        domains_used.push(RetrievalDomain::Shared.label().to_string());
        merge_ranked_recall(&mut selected, dedupe_and_budget_recall(shared_items));
    }

    if recall_retrieval_sufficient(&selected, MIN_RECALL_TOP_SCORE, MIN_RECALL_COUNT) {
        let plan = plan_from(&selected, domains_used);
        return (selected, plan);
    }

    let archive_items: Vec<_> = ranked
        .iter()
        .filter(|entry| {
            recall_item_in_domain(
                &entry.item,
                session_id,
                project_memory_ids,
                RetrievalDomain::Archive,
            )
        })
        .cloned()
        .collect();
    if !archive_items.is_empty() {
        domains_used.push(RetrievalDomain::Archive.label().to_string());
        merge_ranked_recall(&mut selected, dedupe_and_budget_recall(archive_items));
    }

    let plan = plan_from(&selected, domains_used);
    (selected, plan)
}

fn recall_item_in_domain(
    item: &SystemRecallItem,
    session_id: &str,
    project_memory_ids: &HashSet<String>,
    domain: RetrievalDomain,
) -> bool {
    match domain {
        RetrievalDomain::Session => {
            item.session_id.as_deref() == Some(session_id)
                && matches!(item.source_kind.as_str(), "session_message" | "cut_archive")
        }
        RetrievalDomain::Project => match item.source_kind.as_str() {
            "session_message" | "cut_archive" => item.session_id.as_deref() == Some(session_id),
            "long_term_memory" => project_memory_ids.contains(&item.source_id),
            _ => false,
        },
        RetrievalDomain::Shared => item.source_kind == "long_term_memory",
        RetrievalDomain::Archive => match item.source_kind.as_str() {
            "cut_archive" => true,
            "session_message" => item.session_id.as_deref() != Some(session_id),
            _ => false,
        },
    }
}

fn memory_retrieval_sufficient(
    results: &[RankedMemoryRecord],
    min_top_score: f64,
    min_count: usize,
) -> bool {
    results.len() >= min_count
        || results
            .first()
            .is_some_and(|entry| entry.score >= min_top_score)
}

fn recall_retrieval_sufficient(
    results: &[RankedSystemRecallItem],
    min_top_score: f64,
    min_count: usize,
) -> bool {
    results.len() >= min_count
        || results
            .first()
            .is_some_and(|entry| entry.score >= min_top_score)
}

fn merge_ranked_memory(
    selected: &mut Vec<RankedMemoryRecord>,
    incoming: Vec<RankedMemoryRecord>,
    limit: usize,
) {
    let mut seen = selected
        .iter()
        .map(|entry| entry.record.id.clone())
        .collect::<HashSet<_>>();
    for entry in incoming {
        if seen.insert(entry.record.id.clone()) {
            selected.push(entry);
        }
    }
    selected.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    selected.truncate(limit);
}

fn merge_ranked_recall(
    selected: &mut Vec<RankedSystemRecallItem>,
    incoming: Vec<RankedSystemRecallItem>,
) {
    let mut seen = selected
        .iter()
        .map(|entry| entry.item.id.clone())
        .collect::<HashSet<_>>();
    for entry in incoming {
        if seen.insert(entry.item.id.clone()) {
            selected.push(entry);
        }
    }
    selected.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                recall_source_priority(&left.item).cmp(&recall_source_priority(&right.item))
            })
    });
    selected.truncate(SYSTEM_RECALL_LIMIT);
}

fn plan_from(
    selected: &[RankedSystemRecallItem],
    domains_used: Vec<String>,
) -> RetrievalExpansionPlan {
    RetrievalExpansionPlan {
        domains_used,
        top_score: selected.first().map(|entry| entry.score).unwrap_or(0.0),
        selected_count: selected.len(),
    }
}

pub(crate) fn expansion_plan_json(plan: &RetrievalExpansionPlan) -> Value {
    json!({
        "domainsUsed": plan.domains_used,
        "topScore": plan.top_score,
        "selectedCount": plan.selected_count,
    })
}

pub(crate) fn project_scope_memory_ids(root: &Path) -> AgentRuntimeResult<HashSet<String>> {
    let records = list_long_term_memory(
        root,
        MemoryQuery {
            scope: Some("project".to_string()),
            status: Some("active".to_string()),
            limit: 500,
            ..MemoryQuery::default()
        },
    )?;
    Ok(records.into_iter().map(|record| record.id).collect())
}
