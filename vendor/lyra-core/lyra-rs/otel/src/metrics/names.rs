pub const TOOL_CALL_COUNT_METRIC: &str = "lyra.tool.call";
pub const TOOL_CALL_DURATION_METRIC: &str = "lyra.tool.call.duration_ms";
pub const TOOL_CALL_UNIFIED_EXEC_METRIC: &str = "lyra.tool.unified_exec";
pub const API_CALL_COUNT_METRIC: &str = "lyra.api_request";
pub const API_CALL_DURATION_METRIC: &str = "lyra.api_request.duration_ms";
pub const SSE_EVENT_COUNT_METRIC: &str = "lyra.sse_event";
pub const SSE_EVENT_DURATION_METRIC: &str = "lyra.sse_event.duration_ms";
pub const WEBSOCKET_REQUEST_COUNT_METRIC: &str = "lyra.websocket.request";
pub const WEBSOCKET_REQUEST_DURATION_METRIC: &str = "lyra.websocket.request.duration_ms";
pub const WEBSOCKET_EVENT_COUNT_METRIC: &str = "lyra.websocket.event";
pub const WEBSOCKET_EVENT_DURATION_METRIC: &str = "lyra.websocket.event.duration_ms";
pub const RESPONSES_API_OVERHEAD_DURATION_METRIC: &str = "lyra.responses_api_overhead.duration_ms";
pub const RESPONSES_API_INFERENCE_TIME_DURATION_METRIC: &str =
    "lyra.responses_api_inference_time.duration_ms";
pub const RESPONSES_API_ENGINE_IAPI_TTFT_DURATION_METRIC: &str =
    "lyra.responses_api_engine_iapi_ttft.duration_ms";
pub const RESPONSES_API_ENGINE_SERVICE_TTFT_DURATION_METRIC: &str =
    "lyra.responses_api_engine_service_ttft.duration_ms";
pub const RESPONSES_API_ENGINE_IAPI_TBT_DURATION_METRIC: &str =
    "lyra.responses_api_engine_iapi_tbt.duration_ms";
pub const RESPONSES_API_ENGINE_SERVICE_TBT_DURATION_METRIC: &str =
    "lyra.responses_api_engine_service_tbt.duration_ms";
pub const TURN_E2E_DURATION_METRIC: &str = "lyra.turn.e2e_duration_ms";
pub const TURN_TTFT_DURATION_METRIC: &str = "lyra.turn.ttft.duration_ms";
pub const TURN_TTFM_DURATION_METRIC: &str = "lyra.turn.ttfm.duration_ms";
pub const TURN_NETWORK_PROXY_METRIC: &str = "lyra.turn.network_proxy";
pub const TURN_TOOL_CALL_METRIC: &str = "lyra.turn.tool.call";
pub const TURN_TOKEN_USAGE_METRIC: &str = "lyra.turn.token_usage";
pub const PROFILE_USAGE_METRIC: &str = "lyra.profile.usage";
pub const CURATED_PLUGINS_STARTUP_SYNC_METRIC: &str = "lyra.plugins.startup_sync";
pub const CURATED_PLUGINS_STARTUP_SYNC_FINAL_METRIC: &str = "lyra.plugins.startup_sync.final";
pub const HOOK_RUN_METRIC: &str = "lyra.hooks.run";
pub const HOOK_RUN_DURATION_METRIC: &str = "lyra.hooks.run.duration_ms";
/// Total runtime of a startup prewarm attempt until it completes, tagged by final status.
pub const STARTUP_PREWARM_DURATION_METRIC: &str = "lyra.startup_prewarm.duration_ms";
/// Age of the startup prewarm attempt when the first real turn resolves it, tagged by outcome.
pub const STARTUP_PREWARM_AGE_AT_FIRST_TURN_METRIC: &str =
    "lyra.startup_prewarm.age_at_first_turn_ms";
pub const THREAD_STARTED_METRIC: &str = "lyra.thread.started";
pub const THREAD_SKILLS_ENABLED_TOTAL_METRIC: &str = "lyra.thread.skills.enabled_total";
pub const THREAD_SKILLS_KEPT_TOTAL_METRIC: &str = "lyra.thread.skills.kept_total";
pub const THREAD_SKILLS_TRUNCATED_METRIC: &str = "lyra.thread.skills.truncated";
