use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

pub mod helper;

use helper::{
    PerformanceHelperProcessSamples, PerformanceHelperSampleProcessesRequest,
    PerformanceHelperStatus, PerformanceProcessSample, call_helper_sample_processes,
    call_helper_status, configured_helper_transport,
};

const EVENT_RING_CAPACITY: usize = 1024;
const TARGET_REPEATED_RESOURCE_COUNT: usize = 50;
const TARGET_MEMORY_REDUCTION_PERCENT: f64 = 40.0;
const TARGET_CPU_REDUCTION_PERCENT: f64 = 25.0;
const TARGET_RESTORE_P95_MS: u64 = 300;
const HELPER_STATUS_CACHE_TTL: Duration = Duration::from_secs(1);

type EventCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;

static KERNEL: LazyLock<Mutex<PerformanceKernel>> =
    LazyLock::new(|| Mutex::new(PerformanceKernel::new()));
static EVENT_CALLBACK: LazyLock<Mutex<Option<EventCallback>>> = LazyLock::new(|| Mutex::new(None));
static HELPER_STATUS_CACHE: LazyLock<Mutex<Option<CachedHelperStatusProbe>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(Clone, Debug)]
pub struct PerformanceKernelError {
    code: &'static str,
    message: String,
}

impl PerformanceKernelError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            code: "BAD_REQUEST",
            message: message.into(),
        }
    }

    fn method_not_found(method: &str) -> Self {
        Self {
            code: "METHOD_NOT_FOUND",
            message: format!("unknown performance runtime method: {method}"),
        }
    }

    pub fn code(&self) -> &str {
        self.code
    }
}

impl fmt::Display for PerformanceKernelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for PerformanceKernelError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceResourceKind {
    BrowserPage,
    WorkspaceSurface,
    PluginSurface,
    TerminalPane,
    AgentTask,
    DownloadTask,
    LspTask,
    SearchTask,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceResourceLifecycle {
    Foreground,
    Visible,
    HotHidden,
    KeptAlive,
    Throttled,
    Snapshotted,
    Tombstoned,
    Restoring,
}

impl Default for PerformanceResourceLifecycle {
    fn default() -> Self {
        Self::HotHidden
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceActivitySignals {
    #[serde(default)]
    pub has_user_input: bool,
    #[serde(default)]
    pub has_form_draft: bool,
    #[serde(default)]
    pub has_active_media: bool,
    #[serde(default)]
    pub has_permission_prompt: bool,
    #[serde(default)]
    pub has_agent_control: bool,
    #[serde(default)]
    pub has_divergent_storage: bool,
    #[serde(default)]
    pub has_divergent_history: bool,
    #[serde(default)]
    pub is_loading: bool,
    #[serde(default)]
    pub is_fullscreen: bool,
    #[serde(default)]
    pub unknown: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceIsolationFlags {
    #[serde(default)]
    pub requires_dedicated_core: bool,
    #[serde(default)]
    pub contains_sensitive_input: bool,
    #[serde(default)]
    pub authenticated_session: bool,
    #[serde(default)]
    pub cross_origin_state: bool,
    #[serde(default)]
    pub untrusted_plugin: bool,
    #[serde(default)]
    pub elevated_privilege: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceResourceDescriptor {
    pub resource_id: String,
    pub kind: PerformanceResourceKind,
    pub core_key: String,
    pub state_key: String,
    #[serde(default)]
    pub lifecycle: PerformanceResourceLifecycle,
    #[serde(default)]
    pub visible: bool,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub signals: PerformanceActivitySignals,
    #[serde(default)]
    pub isolation: PerformanceIsolationFlags,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_contents_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform_handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_signature: Option<String>,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceDecisionKind {
    Grouped,
    Forked,
    KeptAlive,
    Throttled,
    Snapshotted,
    Restored,
    Degraded,
    AuthorizationRequired,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceDecision {
    pub kind: PerformanceDecisionKind,
    pub reason: String,
    pub resource_id: String,
    pub assigned_core_id: String,
    #[serde(default)]
    pub affected_resource_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceKernelEvent {
    pub sequence: u64,
    pub at: i64,
    pub decision: PerformanceDecisionKind,
    pub resource_id: String,
    pub kind: PerformanceResourceKind,
    pub core_key: String,
    pub state_key: String,
    pub assigned_core_id: String,
    pub reason: String,
    pub degraded: bool,
    #[serde(default)]
    pub affected_resource_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceCoreGroup {
    pub core_id: String,
    pub kind: PerformanceResourceKind,
    pub core_key: String,
    pub shared_signature: String,
    pub live_resource_id: String,
    pub resource_ids: Vec<String>,
    pub state_keys: Vec<String>,
    pub reusable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSavingsEstimate {
    pub baseline_resource_units: usize,
    pub scheduled_core_units: usize,
    pub memory_reduction_percent: f64,
    pub cpu_reduction_percent: f64,
    pub restore_p95_target_ms: u64,
    pub meets_v1_target: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformancePlatformAdapterStatus {
    pub platform: String,
    pub adapter_kind: String,
    pub supported: bool,
    pub authorization_required: bool,
    pub authorized: bool,
    pub helper_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helper_transport: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helper_status: Option<PerformanceHelperStatus>,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceKernelStatus {
    pub mode: String,
    pub full_kernel_available: bool,
    pub authorization_required: bool,
    pub authorized: bool,
    pub platform_adapter: PerformancePlatformAdapterStatus,
    pub resources: usize,
    pub core_groups: usize,
    pub events_retained: usize,
    pub v1_target: PerformanceTarget,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceTarget {
    pub repeated_resource_count: usize,
    pub memory_reduction_percent: f64,
    pub cpu_reduction_percent: f64,
    pub restore_p95_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceKernelSnapshot {
    pub status: PerformanceKernelStatus,
    pub resources: Vec<PerformanceResourceRecord>,
    pub core_groups: Vec<PerformanceCoreGroup>,
    pub savings: PerformanceSavingsEstimate,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformancePressureSnapshot {
    pub at: i64,
    pub helper_available: bool,
    pub helper_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helper_transport: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helper_error: Option<String>,
    pub requested_process_ids: Vec<u32>,
    pub samples: Vec<PerformanceProcessSample>,
    pub total_resident_memory_bytes: u64,
    pub total_cpu_percent: f32,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadPressureSnapshotRequest {
    #[serde(default)]
    process_ids: Vec<u32>,
    #[serde(default = "default_true")]
    include_registered_resources: bool,
    #[serde(default)]
    sample_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunPressureHarnessRequest {
    #[serde(default)]
    repeated_resource_count: Option<usize>,
    #[serde(default)]
    process_ids: Vec<u32>,
    #[serde(default = "default_true")]
    include_registered_resources: bool,
    #[serde(default)]
    sample_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMeasuredSavings {
    pub baseline_resource_units: usize,
    pub logical_scheduled_core_units: usize,
    pub measured_unique_processes: usize,
    pub baseline_resident_memory_bytes: u64,
    pub scheduled_resident_memory_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_reduction_percent: Option<f64>,
    pub baseline_cpu_percent: f32,
    pub scheduled_cpu_percent: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_reduction_percent: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformancePressureAcceptance {
    pub logical_reuse_target_met: bool,
    pub measured_memory_target_met: bool,
    pub measured_cpu_target_met: bool,
    pub restore_p95_target_met: bool,
    pub full_kernel_authorized: bool,
    pub no_cross_state_leaks_detected: bool,
    pub active_work_was_not_interrupted: bool,
    pub meets_v1_target: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformancePressureHarnessResult {
    pub repeated_resource_count: usize,
    pub status: PerformanceKernelStatus,
    pub logical_savings: PerformanceSavingsEstimate,
    pub measured_savings: PerformanceMeasuredSavings,
    pub pressure_snapshot: PerformancePressureSnapshot,
    pub restore_fork_p95_ms: u64,
    pub acceptance: PerformancePressureAcceptance,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceResourceRecord {
    pub resource: PerformanceResourceDescriptor,
    pub safe_to_reuse: bool,
    pub assigned_core_id: String,
    pub last_decision: PerformanceDecisionKind,
    pub last_reason: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnregisterRequest {
    resource_id: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadEventsRequest {
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    since_sequence: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyDecisionRequest {
    resource_id: String,
    decision_kind: PerformanceDecisionKind,
    reason: String,
}

struct UpsertOutcome {
    record: PerformanceResourceRecord,
    event: PerformanceKernelEvent,
}

#[derive(Clone)]
struct HelperStatusProbe {
    helper_configured: bool,
    helper_transport: Option<String>,
    helper_status: Option<PerformanceHelperStatus>,
    helper_error: Option<String>,
}

struct CachedHelperStatusProbe {
    at: Instant,
    probe: HelperStatusProbe,
}

#[derive(Default)]
struct PerformanceKernel {
    resources: BTreeMap<String, PerformanceResourceRecord>,
    events: VecDeque<PerformanceKernelEvent>,
    next_sequence: u64,
}

impl PerformanceKernel {
    fn new() -> Self {
        Self::default()
    }

    fn status(&self) -> PerformanceKernelStatus {
        let platform = read_platform_adapter_status();
        PerformanceKernelStatus {
            mode: if platform.authorized {
                "fullKernel".to_string()
            } else {
                "degraded".to_string()
            },
            full_kernel_available: platform.supported && platform.authorized,
            authorization_required: platform.authorization_required,
            authorized: platform.authorized,
            platform_adapter: platform,
            resources: self.resources.len(),
            core_groups: self.core_groups().len(),
            events_retained: self.events.len(),
            v1_target: PerformanceTarget {
                repeated_resource_count: TARGET_REPEATED_RESOURCE_COUNT,
                memory_reduction_percent: TARGET_MEMORY_REDUCTION_PERCENT,
                cpu_reduction_percent: TARGET_CPU_REDUCTION_PERCENT,
                restore_p95_ms: TARGET_RESTORE_P95_MS,
            },
        }
    }

    fn snapshot(&self) -> PerformanceKernelSnapshot {
        let core_groups = self.core_groups();
        PerformanceKernelSnapshot {
            status: self.status(),
            resources: self.resources.values().cloned().collect(),
            savings: estimate_savings(self.resources.len(), &core_groups),
            core_groups,
        }
    }

    fn read_pressure_snapshot(
        &self,
        request: ReadPressureSnapshotRequest,
    ) -> PerformancePressureSnapshot {
        let process_ids =
            self.collect_process_ids(request.process_ids, request.include_registered_resources);
        let helper_configured = configured_helper_transport().is_some();
        let helper_transport = configured_helper_transport();
        match call_helper_sample_processes(PerformanceHelperSampleProcessesRequest {
            process_ids: process_ids.clone(),
            sample_ms: request.sample_ms,
        }) {
            Ok(Some(samples)) => pressure_snapshot_from_samples(
                process_ids,
                samples,
                helper_configured,
                helper_transport,
                None,
            ),
            Ok(None) => PerformancePressureSnapshot {
                at: Utc::now().timestamp_millis(),
                helper_available: false,
                helper_configured,
                helper_transport,
                helper_error: Some("no OS performance helper transport is configured".to_string()),
                requested_process_ids: process_ids,
                samples: Vec::new(),
                total_resident_memory_bytes: 0,
                total_cpu_percent: 0.0,
            },
            Err(error) => PerformancePressureSnapshot {
                at: Utc::now().timestamp_millis(),
                helper_available: false,
                helper_configured,
                helper_transport,
                helper_error: Some(error),
                requested_process_ids: process_ids,
                samples: Vec::new(),
                total_resident_memory_bytes: 0,
                total_cpu_percent: 0.0,
            },
        }
    }

    fn run_pressure_harness(
        &self,
        request: RunPressureHarnessRequest,
    ) -> PerformancePressureHarnessResult {
        let repeated_resource_count = request
            .repeated_resource_count
            .unwrap_or(TARGET_REPEATED_RESOURCE_COUNT)
            .clamp(1, 10_000);
        let pressure_snapshot = self.read_pressure_snapshot(ReadPressureSnapshotRequest {
            process_ids: request.process_ids,
            include_registered_resources: request.include_registered_resources,
            sample_ms: request.sample_ms,
        });
        let core_groups = self.core_groups();
        let logical_savings = estimate_savings(self.resources.len(), &core_groups);
        let measured_savings = self.measured_savings(
            &pressure_snapshot,
            core_groups.len(),
            repeated_resource_count,
        );
        let restore_fork_p95_ms = measure_restore_fork_p95_ms(repeated_resource_count);
        let status = self.status();
        let acceptance = PerformancePressureAcceptance {
            logical_reuse_target_met: logical_savings.meets_v1_target,
            measured_memory_target_met: measured_savings
                .memory_reduction_percent
                .map(|value| value >= TARGET_MEMORY_REDUCTION_PERCENT)
                .unwrap_or(false),
            measured_cpu_target_met: measured_savings
                .cpu_reduction_percent
                .map(|value| value >= TARGET_CPU_REDUCTION_PERCENT)
                .unwrap_or(false),
            restore_p95_target_met: restore_fork_p95_ms <= TARGET_RESTORE_P95_MS,
            full_kernel_authorized: status.full_kernel_available,
            no_cross_state_leaks_detected: self.no_cross_state_leaks_detected(),
            active_work_was_not_interrupted: self.active_work_was_not_interrupted(),
            meets_v1_target: false,
        };
        let acceptance = PerformancePressureAcceptance {
            meets_v1_target: acceptance.logical_reuse_target_met
                && acceptance.measured_memory_target_met
                && acceptance.measured_cpu_target_met
                && acceptance.restore_p95_target_met
                && acceptance.full_kernel_authorized
                && acceptance.no_cross_state_leaks_detected
                && acceptance.active_work_was_not_interrupted,
            ..acceptance
        };

        PerformancePressureHarnessResult {
            repeated_resource_count,
            status,
            logical_savings,
            measured_savings,
            pressure_snapshot,
            restore_fork_p95_ms,
            acceptance,
        }
    }

    fn collect_process_ids(
        &self,
        mut process_ids: Vec<u32>,
        include_registered_resources: bool,
    ) -> Vec<u32> {
        if include_registered_resources {
            process_ids.extend(
                self.resources
                    .values()
                    .filter_map(|record| record.resource.process_id),
            );
        }
        process_ids
            .into_iter()
            .filter(|process_id| *process_id > 0)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    fn measured_savings(
        &self,
        pressure_snapshot: &PerformancePressureSnapshot,
        logical_scheduled_core_units: usize,
        fallback_baseline_units: usize,
    ) -> PerformanceMeasuredSavings {
        let sample_by_pid = pressure_snapshot
            .samples
            .iter()
            .filter(|sample| sample.exists)
            .map(|sample| (sample.process_id, sample))
            .collect::<BTreeMap<_, _>>();
        let resource_pids = self
            .resources
            .values()
            .filter_map(|record| record.resource.process_id)
            .filter(|process_id| sample_by_pid.contains_key(process_id))
            .collect::<Vec<_>>();
        let baseline_resource_units = if resource_pids.is_empty() {
            fallback_baseline_units
        } else {
            resource_pids.len()
        };
        let mut baseline_resident_memory_bytes = 0u64;
        let mut baseline_cpu_percent = 0f32;
        for process_id in &resource_pids {
            if let Some(sample) = sample_by_pid.get(process_id) {
                baseline_resident_memory_bytes =
                    baseline_resident_memory_bytes.saturating_add(sample.resident_memory_bytes);
                baseline_cpu_percent += sample.cpu_percent;
            }
        }
        let unique_process_ids = resource_pids.iter().copied().collect::<BTreeSet<_>>();
        let mut scheduled_resident_memory_bytes = 0u64;
        let mut scheduled_cpu_percent = 0f32;
        for process_id in &unique_process_ids {
            if let Some(sample) = sample_by_pid.get(process_id) {
                scheduled_resident_memory_bytes =
                    scheduled_resident_memory_bytes.saturating_add(sample.resident_memory_bytes);
                scheduled_cpu_percent += sample.cpu_percent;
            }
        }
        PerformanceMeasuredSavings {
            baseline_resource_units,
            logical_scheduled_core_units: logical_scheduled_core_units.max(1),
            measured_unique_processes: unique_process_ids.len(),
            baseline_resident_memory_bytes,
            scheduled_resident_memory_bytes,
            memory_reduction_percent: percent_reduction(
                baseline_resident_memory_bytes,
                scheduled_resident_memory_bytes,
            ),
            baseline_cpu_percent,
            scheduled_cpu_percent,
            cpu_reduction_percent: percent_reduction_f32(
                baseline_cpu_percent,
                scheduled_cpu_percent,
            ),
        }
    }

    fn no_cross_state_leaks_detected(&self) -> bool {
        let mut state_keys_by_resource = BTreeSet::new();
        for record in self.resources.values() {
            if !state_keys_by_resource.insert(record.resource.state_key.clone()) {
                return false;
            }
        }
        true
    }

    fn active_work_was_not_interrupted(&self) -> bool {
        self.resources.values().all(|record| {
            let resource = &record.resource;
            if resource.active
                || resource.signals.has_user_input
                || resource.signals.has_form_draft
                || resource.signals.has_active_media
                || resource.signals.has_agent_control
            {
                record.last_decision == PerformanceDecisionKind::Forked
            } else {
                true
            }
        })
    }

    fn upsert(&mut self, mut resource: PerformanceResourceDescriptor) -> UpsertOutcome {
        normalize_resource(&mut resource);
        let safe_to_reuse = is_resource_safe_to_reuse(&resource);
        let (assigned_core_id, decision, reason, affected_resource_ids) =
            self.schedule_resource(&resource, safe_to_reuse);
        let record = PerformanceResourceRecord {
            resource: resource.clone(),
            safe_to_reuse,
            assigned_core_id: assigned_core_id.clone(),
            last_decision: decision,
            last_reason: reason.clone(),
        };
        self.resources
            .insert(resource.resource_id.clone(), record.clone());
        let event = self.record_event(
            decision,
            &resource,
            assigned_core_id,
            reason,
            affected_resource_ids,
        );
        UpsertOutcome { record, event }
    }

    fn unregister(&mut self, resource_id: &str) -> Option<PerformanceKernelEvent> {
        let record = self.resources.remove(resource_id)?;
        Some(self.record_event(
            PerformanceDecisionKind::Restored,
            &record.resource,
            record.assigned_core_id,
            "resource unregistered from the performance kernel".to_string(),
            Vec::new(),
        ))
    }

    fn apply_decision(
        &mut self,
        request: ApplyDecisionRequest,
    ) -> Result<PerformanceKernelEvent, PerformanceKernelError> {
        let record = self
            .resources
            .get(&request.resource_id)
            .cloned()
            .ok_or_else(|| PerformanceKernelError::bad_request("resourceId is not registered"))?;
        Ok(self.record_event(
            request.decision_kind,
            &record.resource,
            record.assigned_core_id,
            request.reason,
            Vec::new(),
        ))
    }

    fn schedule_resource(
        &self,
        resource: &PerformanceResourceDescriptor,
        safe_to_reuse: bool,
    ) -> (String, PerformanceDecisionKind, String, Vec<String>) {
        if !safe_to_reuse {
            return (
                dedicated_core_id(&resource.resource_id),
                PerformanceDecisionKind::Forked,
                unsafe_reason(resource),
                Vec::new(),
            );
        }

        let group_key = resource_group_key(resource);
        let existing_group: Vec<&PerformanceResourceRecord> = self
            .resources
            .values()
            .filter(|record| {
                record.resource.resource_id != resource.resource_id
                    && record.safe_to_reuse
                    && resource_group_key(&record.resource) == group_key
            })
            .collect();

        let assigned_core_id = reusable_core_id(&group_key);
        if existing_group.is_empty() {
            return (
                assigned_core_id,
                PerformanceDecisionKind::KeptAlive,
                "first safe resource for reusable core; hidden resources stay kept alive by default".to_string(),
                Vec::new(),
            );
        }

        let affected_resource_ids = existing_group
            .iter()
            .map(|record| record.resource.resource_id.clone())
            .chain(std::iter::once(resource.resource_id.clone()))
            .collect();
        (
            assigned_core_id,
            PerformanceDecisionKind::Grouped,
            "resource shares a proven-clean coreKey/signature while retaining an independent stateKey".to_string(),
            affected_resource_ids,
        )
    }

    fn core_groups(&self) -> Vec<PerformanceCoreGroup> {
        let mut grouped: BTreeMap<String, Vec<&PerformanceResourceRecord>> = BTreeMap::new();
        for record in self.resources.values() {
            grouped
                .entry(record.assigned_core_id.clone())
                .or_default()
                .push(record);
        }
        grouped
            .into_iter()
            .filter_map(|(core_id, records)| {
                let first = records.first()?;
                let resource_ids = records
                    .iter()
                    .map(|record| record.resource.resource_id.clone())
                    .collect::<Vec<_>>();
                let state_keys = records
                    .iter()
                    .map(|record| record.resource.state_key.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect::<Vec<_>>();
                Some(PerformanceCoreGroup {
                    core_id,
                    kind: first.resource.kind,
                    core_key: first.resource.core_key.clone(),
                    shared_signature: shared_signature(&first.resource),
                    live_resource_id: first.resource.resource_id.clone(),
                    resource_ids,
                    state_keys,
                    reusable: first.safe_to_reuse,
                })
            })
            .collect()
    }

    fn read_events(&self, request: ReadEventsRequest) -> Vec<PerformanceKernelEvent> {
        let limit = request
            .limit
            .map(|value| value.clamp(1, EVENT_RING_CAPACITY))
            .unwrap_or(EVENT_RING_CAPACITY);
        let mut events = self
            .events
            .iter()
            .filter(|event| {
                request
                    .since_sequence
                    .map(|sequence| event.sequence > sequence)
                    .unwrap_or(true)
            })
            .cloned()
            .collect::<Vec<_>>();
        if events.len() > limit {
            events = events.split_off(events.len() - limit);
        }
        events
    }

    fn record_event(
        &mut self,
        decision: PerformanceDecisionKind,
        resource: &PerformanceResourceDescriptor,
        assigned_core_id: String,
        reason: String,
        affected_resource_ids: Vec<String>,
    ) -> PerformanceKernelEvent {
        self.next_sequence += 1;
        let platform = read_platform_adapter_status();
        let event = PerformanceKernelEvent {
            sequence: self.next_sequence,
            at: Utc::now().timestamp_millis(),
            decision,
            resource_id: resource.resource_id.clone(),
            kind: resource.kind,
            core_key: resource.core_key.clone(),
            state_key: resource.state_key.clone(),
            assigned_core_id,
            reason,
            degraded: !platform.authorized,
            affected_resource_ids,
        };
        self.events.push_back(event.clone());
        while self.events.len() > EVENT_RING_CAPACITY {
            self.events.pop_front();
        }
        emit_event(&event);
        event
    }
}

pub fn register_performance_event_callback(callback: EventCallback) {
    if let Ok(mut slot) = EVENT_CALLBACK.lock() {
        *slot = Some(callback);
    }
}

pub fn clear_performance_event_callback() {
    if let Ok(mut slot) = EVENT_CALLBACK.lock() {
        *slot = None;
    }
}

pub fn handle_performance_request(
    method: &str,
    payload: Value,
) -> Result<Value, PerformanceKernelError> {
    match method {
        "performance.status" => with_kernel(|kernel| to_value(kernel.status())),
        "performance.registerResource" | "performance.updateResource" => {
            let resource: PerformanceResourceDescriptor = from_value(payload)?;
            with_kernel(|kernel| {
                let outcome = kernel.upsert(resource);
                Ok(json!({
                    "resource": outcome.record,
                    "event": outcome.event
                }))
            })
        }
        "performance.unregisterResource" => {
            let request: UnregisterRequest = from_value(payload)?;
            with_kernel(|kernel| {
                Ok(json!({
                    "removed": kernel.unregister(&request.resource_id).is_some()
                }))
            })
        }
        "performance.readSnapshot" => with_kernel(|kernel| to_value(kernel.snapshot())),
        "performance.readPressureSnapshot" => {
            let request: ReadPressureSnapshotRequest = from_value_or_default(payload)?;
            with_kernel(|kernel| to_value(kernel.read_pressure_snapshot(request)))
        }
        "performance.runPressureHarness" => {
            let request: RunPressureHarnessRequest = from_value_or_default(payload)?;
            with_kernel(|kernel| to_value(kernel.run_pressure_harness(request)))
        }
        "performance.readEvents" => {
            let request: ReadEventsRequest = from_value_or_default(payload)?;
            with_kernel(|kernel| to_value(kernel.read_events(request)))
        }
        "performance.applyDecision" => {
            let request: ApplyDecisionRequest = from_value(payload)?;
            with_kernel(|kernel| to_value(kernel.apply_decision(request)?))
        }
        other => Err(PerformanceKernelError::method_not_found(other)),
    }
}

fn with_kernel<T>(
    f: impl FnOnce(&mut PerformanceKernel) -> Result<T, PerformanceKernelError>,
) -> Result<T, PerformanceKernelError> {
    let mut kernel = KERNEL
        .lock()
        .map_err(|_| PerformanceKernelError::bad_request("performance kernel lock poisoned"))?;
    f(&mut kernel)
}

fn from_value<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, PerformanceKernelError> {
    serde_json::from_value(payload)
        .map_err(|error| PerformanceKernelError::bad_request(error.to_string()))
}

fn from_value_or_default<T>(payload: Value) -> Result<T, PerformanceKernelError>
where
    T: for<'de> Deserialize<'de> + Default,
{
    if payload.is_null() {
        return Ok(T::default());
    }
    from_value(payload)
}

fn to_value<T: Serialize>(value: T) -> Result<Value, PerformanceKernelError> {
    serde_json::to_value(value)
        .map_err(|error| PerformanceKernelError::bad_request(error.to_string()))
}

fn normalize_resource(resource: &mut PerformanceResourceDescriptor) {
    resource.resource_id = resource.resource_id.trim().to_string();
    resource.core_key = resource.core_key.trim().to_string();
    resource.state_key = resource.state_key.trim().to_string();
    resource.shared_signature = resource
        .shared_signature
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if resource.updated_at <= 0 {
        resource.updated_at = Utc::now().timestamp_millis();
    }
}

fn is_resource_safe_to_reuse(resource: &PerformanceResourceDescriptor) -> bool {
    !resource.active
        && !resource.signals.has_user_input
        && !resource.signals.has_form_draft
        && !resource.signals.has_active_media
        && !resource.signals.has_permission_prompt
        && !resource.signals.has_agent_control
        && !resource.signals.has_divergent_storage
        && !resource.signals.has_divergent_history
        && !resource.signals.is_loading
        && !resource.signals.is_fullscreen
        && !resource.signals.unknown
        && !resource.isolation.requires_dedicated_core
        && !resource.isolation.contains_sensitive_input
        && !resource.isolation.authenticated_session
        && !resource.isolation.cross_origin_state
        && !resource.isolation.untrusted_plugin
        && !resource.isolation.elevated_privilege
        && resource.resource_id.is_empty() == false
        && resource.core_key.is_empty() == false
        && resource.state_key.is_empty() == false
}

fn unsafe_reason(resource: &PerformanceResourceDescriptor) -> String {
    let mut reasons = Vec::new();
    if resource.active {
        reasons.push("active");
    }
    if resource.signals.has_user_input {
        reasons.push("user-input");
    }
    if resource.signals.has_form_draft {
        reasons.push("form-draft");
    }
    if resource.signals.has_active_media {
        reasons.push("active-media");
    }
    if resource.signals.has_permission_prompt {
        reasons.push("permission-prompt");
    }
    if resource.signals.has_agent_control {
        reasons.push("agent-control");
    }
    if resource.signals.has_divergent_storage {
        reasons.push("divergent-storage");
    }
    if resource.signals.has_divergent_history {
        reasons.push("divergent-history");
    }
    if resource.signals.is_loading {
        reasons.push("loading");
    }
    if resource.signals.is_fullscreen {
        reasons.push("fullscreen");
    }
    if resource.signals.unknown {
        reasons.push("unknown-signal");
    }
    if resource.isolation.requires_dedicated_core {
        reasons.push("dedicated-core-required");
    }
    if resource.isolation.contains_sensitive_input {
        reasons.push("sensitive-input");
    }
    if resource.isolation.authenticated_session {
        reasons.push("authenticated-session");
    }
    if resource.isolation.cross_origin_state {
        reasons.push("cross-origin-state");
    }
    if resource.isolation.untrusted_plugin {
        reasons.push("untrusted-plugin");
    }
    if resource.isolation.elevated_privilege {
        reasons.push("elevated-privilege");
    }
    if resource.resource_id.is_empty()
        || resource.core_key.is_empty()
        || resource.state_key.is_empty()
    {
        reasons.push("missing-identity");
    }
    if reasons.is_empty() {
        return "reuse safety could not be proven".to_string();
    }
    format!(
        "forked because correctness-first reuse safety failed: {}",
        reasons.join(", ")
    )
}

fn shared_signature(resource: &PerformanceResourceDescriptor) -> String {
    resource
        .shared_signature
        .clone()
        .unwrap_or_else(|| resource.core_key.clone())
}

fn resource_group_key(resource: &PerformanceResourceDescriptor) -> String {
    format!(
        "{:?}|{}|{}",
        resource.kind,
        resource.core_key,
        shared_signature(resource)
    )
}

fn reusable_core_id(group_key: &str) -> String {
    format!("core:{}", stable_hash(group_key))
}

fn dedicated_core_id(resource_id: &str) -> String {
    format!("dedicated:{}", stable_hash(resource_id))
}

fn stable_hash(value: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn estimate_savings(
    resource_count: usize,
    groups: &[PerformanceCoreGroup],
) -> PerformanceSavingsEstimate {
    if resource_count == 0 {
        return PerformanceSavingsEstimate {
            baseline_resource_units: 0,
            scheduled_core_units: 0,
            memory_reduction_percent: 0.0,
            cpu_reduction_percent: 0.0,
            restore_p95_target_ms: TARGET_RESTORE_P95_MS,
            meets_v1_target: false,
        };
    }
    let scheduled_core_units = groups.len().max(1);
    let baseline = resource_count as f64;
    let scheduled = scheduled_core_units as f64;
    let memory_reduction_percent = ((baseline - scheduled) / baseline * 100.0).max(0.0);
    let grouped_hidden_resources = groups
        .iter()
        .filter(|group| group.reusable)
        .map(|group| group.resource_ids.len().saturating_sub(1))
        .sum::<usize>();
    let cpu_reduction_percent =
        (grouped_hidden_resources as f64 / baseline * 100.0).min(memory_reduction_percent);
    PerformanceSavingsEstimate {
        baseline_resource_units: resource_count,
        scheduled_core_units,
        memory_reduction_percent: round_percent(memory_reduction_percent),
        cpu_reduction_percent: round_percent(cpu_reduction_percent),
        restore_p95_target_ms: TARGET_RESTORE_P95_MS,
        meets_v1_target: memory_reduction_percent >= TARGET_MEMORY_REDUCTION_PERCENT
            && cpu_reduction_percent >= TARGET_CPU_REDUCTION_PERCENT,
    }
}

fn round_percent(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn read_platform_adapter_status() -> PerformancePlatformAdapterStatus {
    let platform = std::env::consts::OS;
    let helper_probe = read_helper_status_probe();
    let authorized = helper_probe
        .helper_status
        .as_ref()
        .map(|status| {
            status.protocol_version == helper::HELPER_PROTOCOL_VERSION
                && status.elevated
                && status.can_sample_processes
        })
        .unwrap_or(false);
    match platform {
        "macos" => PerformancePlatformAdapterStatus {
            platform: "macos".to_string(),
            adapter_kind: "serviceManagementLaunchDaemon".to_string(),
            supported: true,
            authorization_required: true,
            authorized,
            helper_configured: helper_probe.helper_configured,
            helper_transport: helper_probe.helper_transport,
            helper_status: helper_probe.helper_status,
            notes: adapter_notes(
                authorized,
                "System Extensions, Service Management, and LaunchDaemon helper",
                helper_probe.helper_error,
            ),
        },
        "windows" => PerformancePlatformAdapterStatus {
            platform: "windows".to_string(),
            adapter_kind: "windowsServiceJobObject".to_string(),
            supported: true,
            authorization_required: true,
            authorized,
            helper_configured: helper_probe.helper_configured,
            helper_transport: helper_probe.helper_transport,
            helper_status: helper_probe.helper_status,
            notes: adapter_notes(
                authorized,
                "Windows service and Job Objects",
                helper_probe.helper_error,
            ),
        },
        "linux" => PerformancePlatformAdapterStatus {
            platform: "linux".to_string(),
            adapter_kind: "cgroupV2SystemdPsi".to_string(),
            supported: true,
            authorization_required: true,
            authorized,
            helper_configured: helper_probe.helper_configured,
            helper_transport: helper_probe.helper_transport,
            helper_status: helper_probe.helper_status,
            notes: adapter_notes(
                authorized,
                "systemd/cgroup v2, PSI, and optional eBPF probes",
                helper_probe.helper_error,
            ),
        },
        other => PerformancePlatformAdapterStatus {
            platform: other.to_string(),
            adapter_kind: "unsupported".to_string(),
            supported: false,
            authorization_required: true,
            authorized: false,
            helper_configured: helper_probe.helper_configured,
            helper_transport: helper_probe.helper_transport,
            helper_status: helper_probe.helper_status,
            notes: vec!["platform adapter is not implemented for this target".to_string()],
        },
    }
}

fn read_helper_status_probe() -> HelperStatusProbe {
    let now = Instant::now();
    if let Ok(cache) = HELPER_STATUS_CACHE.lock() {
        if let Some(cached) = cache.as_ref() {
            if now.duration_since(cached.at) <= HELPER_STATUS_CACHE_TTL {
                return cached.probe.clone();
            }
        }
    }

    let helper_transport = configured_helper_transport();
    let helper_configured = helper_transport.is_some();
    let helper_result = call_helper_status();
    let (helper_status, helper_error) = match helper_result {
        Ok(status) => (status, None),
        Err(error) => (None, Some(error)),
    };
    let probe = HelperStatusProbe {
        helper_configured,
        helper_transport,
        helper_status,
        helper_error,
    };
    if let Ok(mut cache) = HELPER_STATUS_CACHE.lock() {
        *cache = Some(CachedHelperStatusProbe {
            at: now,
            probe: probe.clone(),
        });
    }
    probe
}

fn adapter_notes(authorized: bool, adapter: &str, helper_error: Option<String>) -> Vec<String> {
    if authorized {
        vec![format!("{adapter} adapter authorized for full kernel mode")]
    } else {
        let mut notes = vec![
            format!("{adapter} adapter requires OS authorization"),
            "temporary degraded app-level scheduling is active for this session".to_string(),
        ];
        if let Some(error) = helper_error {
            notes.push(format!("performance helper unavailable: {error}"));
        } else if configured_helper_transport().is_none() {
            notes.push(
                "set LYRA_PERFORMANCE_HELPER_SOCKET, LYRA_PERFORMANCE_HELPER_TCP, or LYRA_PERFORMANCE_HELPER_BIN after installing the helper".to_string(),
            );
        }
        notes
    }
}

fn pressure_snapshot_from_samples(
    requested_process_ids: Vec<u32>,
    samples: PerformanceHelperProcessSamples,
    helper_configured: bool,
    helper_transport: Option<String>,
    helper_error: Option<String>,
) -> PerformancePressureSnapshot {
    let total_resident_memory_bytes = samples
        .samples
        .iter()
        .filter(|sample| sample.exists)
        .map(|sample| sample.resident_memory_bytes)
        .sum();
    let total_cpu_percent = samples
        .samples
        .iter()
        .filter(|sample| sample.exists)
        .map(|sample| sample.cpu_percent)
        .sum();
    PerformancePressureSnapshot {
        at: samples.at,
        helper_available: true,
        helper_configured,
        helper_transport,
        helper_error,
        requested_process_ids,
        samples: samples.samples,
        total_resident_memory_bytes,
        total_cpu_percent,
    }
}

fn percent_reduction(baseline: u64, scheduled: u64) -> Option<f64> {
    if baseline == 0 {
        return None;
    }
    Some(round_percent(
        ((baseline.saturating_sub(scheduled)) as f64 / baseline as f64 * 100.0).max(0.0),
    ))
}

fn percent_reduction_f32(baseline: f32, scheduled: f32) -> Option<f64> {
    if baseline <= 0.0 {
        return None;
    }
    Some(round_percent(
        ((baseline - scheduled).max(0.0) as f64 / baseline as f64 * 100.0).max(0.0),
    ))
}

fn measure_restore_fork_p95_ms(repeated_resource_count: usize) -> u64 {
    let mut kernel = PerformanceKernel::new();
    let mut samples = Vec::with_capacity(repeated_resource_count);
    for index in 0..repeated_resource_count {
        let mut resource = synthetic_harness_resource(index);
        if index + 1 == repeated_resource_count {
            resource.signals.has_form_draft = true;
        }
        let started = Instant::now();
        let _ = kernel.upsert(resource);
        samples.push(started.elapsed().as_millis() as u64);
    }
    percentile_95(samples)
}

fn percentile_95(mut samples: Vec<u64>) -> u64 {
    if samples.is_empty() {
        return 0;
    }
    samples.sort_unstable();
    let index = ((samples.len() as f64 * 0.95).ceil() as usize).saturating_sub(1);
    samples[index.min(samples.len() - 1)]
}

fn synthetic_harness_resource(index: usize) -> PerformanceResourceDescriptor {
    PerformanceResourceDescriptor {
        resource_id: format!("harness:browserPage:{index}"),
        kind: PerformanceResourceKind::BrowserPage,
        core_key: "lyra://harness/repeated-page".to_string(),
        state_key: format!("lyra://harness/state/{index}"),
        lifecycle: PerformanceResourceLifecycle::HotHidden,
        visible: false,
        active: false,
        signals: PerformanceActivitySignals::default(),
        isolation: PerformanceIsolationFlags::default(),
        process_id: None,
        web_contents_id: Some(index as u32),
        platform_handle: None,
        shared_signature: Some("lyra://harness/repeated-page#clean".to_string()),
        updated_at: Utc::now().timestamp_millis(),
    }
}

fn default_true() -> bool {
    true
}

fn emit_event(event: &PerformanceKernelEvent) {
    let callback = EVENT_CALLBACK.lock().ok().and_then(|slot| slot.clone());
    let Some(callback) = callback else {
        return;
    };
    if let Ok(payload) = serde_json::to_string(event) {
        callback(payload);
    }
}

#[cfg(test)]
fn reset_kernel_for_tests() {
    let mut kernel = KERNEL.lock().expect("kernel lock");
    *kernel = PerformanceKernel::new();
    let mut helper_cache = HELPER_STATUS_CACHE
        .lock()
        .expect("helper status cache lock");
    *helper_cache = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn browser_resource(id: usize) -> PerformanceResourceDescriptor {
        PerformanceResourceDescriptor {
            resource_id: format!("browserPage:{id}"),
            kind: PerformanceResourceKind::BrowserPage,
            core_key: "https://example.test".to_string(),
            state_key: format!("web-state:{id}"),
            lifecycle: PerformanceResourceLifecycle::HotHidden,
            visible: false,
            active: false,
            signals: PerformanceActivitySignals::default(),
            isolation: PerformanceIsolationFlags::default(),
            process_id: Some(100),
            web_contents_id: Some(id as u32),
            platform_handle: None,
            shared_signature: Some("https://example.test/home".to_string()),
            updated_at: 1,
        }
    }

    #[test]
    fn groups_fifty_proven_clean_duplicate_browser_pages() {
        reset_kernel_for_tests();
        for index in 0..50 {
            handle_performance_request(
                "performance.registerResource",
                serde_json::to_value(browser_resource(index)).expect("resource"),
            )
            .expect("register");
        }

        let snapshot: PerformanceKernelSnapshot = serde_json::from_value(
            handle_performance_request("performance.readSnapshot", Value::Null).expect("snapshot"),
        )
        .expect("decode snapshot");

        assert_eq!(snapshot.resources.len(), 50);
        assert_eq!(snapshot.core_groups.len(), 1);
        assert_eq!(snapshot.core_groups[0].state_keys.len(), 50);
        assert!(snapshot.savings.memory_reduction_percent >= 40.0);
        assert!(snapshot.savings.cpu_reduction_percent >= 25.0);
        assert!(snapshot.savings.meets_v1_target);
    }

    #[test]
    fn forks_when_mutable_form_state_appears() {
        reset_kernel_for_tests();
        let first = browser_resource(1);
        let mut second = browser_resource(2);
        handle_performance_request(
            "performance.registerResource",
            serde_json::to_value(first).expect("resource"),
        )
        .expect("register first");

        second.signals.has_form_draft = true;
        let result = handle_performance_request(
            "performance.updateResource",
            serde_json::to_value(second).expect("resource"),
        )
        .expect("register second");
        let decision = result
            .pointer("/event/decision")
            .and_then(Value::as_str)
            .expect("decision");

        assert_eq!(decision, "forked");
        let snapshot: PerformanceKernelSnapshot = serde_json::from_value(
            handle_performance_request("performance.readSnapshot", Value::Null).expect("snapshot"),
        )
        .expect("decode snapshot");
        assert_eq!(snapshot.core_groups.len(), 2);
        assert!(
            snapshot
                .resources
                .iter()
                .any(|record| record.resource.resource_id == "browserPage:2"
                    && !record.safe_to_reuse)
        );
    }

    #[test]
    fn reports_degraded_authorization_fallback_without_losing_scheduler_events() {
        reset_kernel_for_tests();
        let result = handle_performance_request(
            "performance.registerResource",
            serde_json::to_value(browser_resource(1)).expect("resource"),
        )
        .expect("register");
        assert_eq!(
            result
                .pointer("/event/degraded")
                .and_then(Value::as_bool)
                .expect("degraded"),
            true
        );

        let status: PerformanceKernelStatus = serde_json::from_value(
            handle_performance_request("performance.status", Value::Null).expect("status"),
        )
        .expect("decode status");
        assert_eq!(status.authorization_required, true);
        assert_eq!(status.full_kernel_available, status.authorized);
    }

    #[test]
    fn covers_all_v1_resource_kinds_in_pressure_harness() {
        reset_kernel_for_tests();
        let kinds = [
            PerformanceResourceKind::BrowserPage,
            PerformanceResourceKind::WorkspaceSurface,
            PerformanceResourceKind::PluginSurface,
            PerformanceResourceKind::TerminalPane,
            PerformanceResourceKind::AgentTask,
            PerformanceResourceKind::DownloadTask,
            PerformanceResourceKind::LspTask,
            PerformanceResourceKind::SearchTask,
        ];

        for (index, kind) in kinds.into_iter().enumerate() {
            let mut resource = browser_resource(index);
            resource.kind = kind;
            resource.resource_id = format!("{kind:?}:{index}");
            resource.core_key = format!("{kind:?}:shared-core");
            resource.state_key = format!("{kind:?}:state:{index}");
            resource.shared_signature = Some(format!("{kind:?}:signature"));
            handle_performance_request(
                "performance.registerResource",
                serde_json::to_value(resource).expect("resource"),
            )
            .expect("register");
        }

        let snapshot: PerformanceKernelSnapshot = serde_json::from_value(
            handle_performance_request("performance.readSnapshot", Value::Null).expect("snapshot"),
        )
        .expect("decode snapshot");
        assert_eq!(snapshot.resources.len(), 8);
        assert_eq!(snapshot.core_groups.len(), 8);
    }

    #[test]
    fn helper_samples_current_process_for_real_pressure_metrics() {
        let process_id = std::process::id();
        let samples = helper::sample_processes(PerformanceHelperSampleProcessesRequest {
            process_ids: vec![process_id],
            sample_ms: Some(1),
        });
        let sample = samples.samples.first().expect("sample");
        assert_eq!(sample.process_id, process_id);
        assert!(sample.exists);
        assert!(sample.resident_memory_bytes > 0);
    }

    #[test]
    fn measured_harness_savings_count_duplicate_resource_pids_against_unique_scheduled_pids() {
        reset_kernel_for_tests();
        let process_id = std::process::id();
        let mut kernel = PerformanceKernel::new();
        for index in 0..50 {
            let mut resource = browser_resource(index);
            resource.process_id = Some(process_id);
            kernel.upsert(resource);
        }
        let pressure_snapshot = PerformancePressureSnapshot {
            at: 1,
            helper_available: true,
            helper_configured: true,
            helper_transport: Some("test".to_string()),
            helper_error: None,
            requested_process_ids: vec![process_id],
            samples: vec![PerformanceProcessSample {
                process_id,
                exists: true,
                resident_memory_bytes: 100,
                virtual_memory_bytes: 200,
                cpu_percent: 10.0,
                name: Some("test".to_string()),
            }],
            total_resident_memory_bytes: 100,
            total_cpu_percent: 10.0,
        };

        let measured = kernel.measured_savings(&pressure_snapshot, 1, 50);

        assert_eq!(measured.baseline_resource_units, 50);
        assert_eq!(measured.measured_unique_processes, 1);
        assert_eq!(measured.baseline_resident_memory_bytes, 5000);
        assert_eq!(measured.scheduled_resident_memory_bytes, 100);
        assert_eq!(measured.memory_reduction_percent, Some(98.0));
        assert_eq!(measured.cpu_reduction_percent, Some(98.0));
    }
}
