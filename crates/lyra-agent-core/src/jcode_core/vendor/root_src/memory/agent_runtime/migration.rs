use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::visibility::{ModelContextPolicy, UiPolicy, Visibility};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OldJournalEntryKind {
    VisibleAssistantText,
    ReloadMarker,
    Summary,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OldJournalEntryDraft {
    pub kind: OldJournalEntryKind,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub has_lineage: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OldJournalImportDisposition {
    VisibleTimelineMessage,
    AuditOnlyRuntimeEvent,
    LowConfidenceSummaryProjection,
    IgnoredMissingLineage,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OldJournalImportAction {
    pub disposition: OldJournalImportDisposition,
    pub visibility: Visibility,
    pub model_context_policy: ModelContextPolicy,
    pub ui_policy: UiPolicy,
    pub confidence: Option<String>,
    pub becomes_primary_truth: bool,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OldJournalImportPlan {
    pub source_path: String,
    pub target_session_id: String,
    pub enabled_for_startup: bool,
}

pub trait OldJournalImporter {
    fn plan(
        &self,
        source_path: impl Into<String>,
        target_session_id: impl Into<String>,
    ) -> OldJournalImportPlan;
    fn classify_entry(&self, entry: OldJournalEntryDraft) -> OldJournalImportAction;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct DisabledOldJournalImporter;

impl OldJournalImportPlan {
    pub fn disabled(source_path: impl Into<String>, target_session_id: impl Into<String>) -> Self {
        Self {
            source_path: source_path.into(),
            target_session_id: target_session_id.into(),
            enabled_for_startup: false,
        }
    }

    pub fn classify_entry(&self, entry: OldJournalEntryDraft) -> OldJournalImportAction {
        classify_old_journal_entry(entry)
    }
}

impl OldJournalImporter for DisabledOldJournalImporter {
    fn plan(
        &self,
        source_path: impl Into<String>,
        target_session_id: impl Into<String>,
    ) -> OldJournalImportPlan {
        OldJournalImportPlan::disabled(source_path, target_session_id)
    }

    fn classify_entry(&self, entry: OldJournalEntryDraft) -> OldJournalImportAction {
        classify_old_journal_entry(entry)
    }
}

pub fn classify_old_journal_entry(entry: OldJournalEntryDraft) -> OldJournalImportAction {
    match entry.kind {
        OldJournalEntryKind::VisibleAssistantText => OldJournalImportAction {
            disposition: OldJournalImportDisposition::VisibleTimelineMessage,
            visibility: Visibility::UserVisible,
            model_context_policy: ModelContextPolicy::Include,
            ui_policy: UiPolicy::ShowInTimeline,
            confidence: None,
            becomes_primary_truth: false,
            payload: entry.payload,
        },
        OldJournalEntryKind::ReloadMarker => OldJournalImportAction {
            disposition: OldJournalImportDisposition::AuditOnlyRuntimeEvent,
            visibility: Visibility::AuditOnly,
            model_context_policy: ModelContextPolicy::Exclude,
            ui_policy: UiPolicy::ShowInDetailsOnly,
            confidence: None,
            becomes_primary_truth: false,
            payload: entry.payload,
        },
        OldJournalEntryKind::Summary if entry.has_lineage => OldJournalImportAction {
            disposition: OldJournalImportDisposition::LowConfidenceSummaryProjection,
            visibility: Visibility::AuditOnly,
            model_context_policy: ModelContextPolicy::IncludeSummarized,
            ui_policy: UiPolicy::ShowInDetailsOnly,
            confidence: Some("low".to_string()),
            becomes_primary_truth: false,
            payload: entry.payload,
        },
        OldJournalEntryKind::Summary => OldJournalImportAction {
            disposition: OldJournalImportDisposition::IgnoredMissingLineage,
            visibility: Visibility::AuditOnly,
            model_context_policy: ModelContextPolicy::Exclude,
            ui_policy: UiPolicy::HideFromUser,
            confidence: Some("lineage_missing".to_string()),
            becomes_primary_truth: false,
            payload: entry.payload,
        },
    }
}
