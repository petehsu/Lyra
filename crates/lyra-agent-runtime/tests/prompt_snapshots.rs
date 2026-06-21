use lyra_agent_runtime::prompt_contract::current_prompt_runtime_contract;
use lyra_agent_runtime::prompt_policy::{
    PersonaContext, PromptAccounting, PromptBuildReport, PromptDeliveryMode, PromptPolicyInput,
    build_system_prompt_report,
};
use serde_json::{Value, json};

fn persona() -> PersonaContext {
    PersonaContext {
        current_time: Some("Monday, June 22, 2026, 9:30 AM GMT+8".to_string()),
        location_label: Some("Shanghai, China".to_string()),
        device_summary: Some("macOS arm64 · Lyra test fixture".to_string()),
        user_name: Some("petehsu".to_string()),
    }
}

fn accounting() -> PromptAccounting {
    PromptAccounting {
        system_budget: 1200,
        tools_budget: 800,
        memory_budget: 600,
        history_budget: 400,
        artifact_budget: 200,
    }
}

fn runtime_context(scene: &str) -> Value {
    json!({
        "identity": "Lyra",
        "toolFilesystem": {
            "scene": scene,
            "rootSummary": {
                "path": "/tools",
                "searchAvailable": true,
                "recommendedDiscovery": "Search natural-language intent before browsing directories."
            },
            "presearchHints": [
                {
                    "query": "browser brower 浏览器操作",
                    "fallbackListPath": "/tools/browser"
                }
            ]
        },
        "memoryLayers": {
            "workingMemory": {
                "latestUserIntent": "inspect the current browser page and cite it"
            },
            "pinnedContext": [
                {
                    "kind": "repo",
                    "title": "Lyra",
                    "summary": "Dynamic prompt delivery refactor"
                }
            ],
            "systemRecall": [
                {
                    "summary": "Prompt prose should live in prompt templates, not Rust helper strings."
                }
            ]
        }
    })
}

fn memory_prompt() -> &'static str {
    "Project: Lyra dynamic prompt delivery\nPreference: keep Tool-FS knowledge in catalog/search/inspect instead of always-on system prompt"
}

fn full_report() -> PromptBuildReport {
    build_system_prompt_report(&PromptPolicyInput {
        runtime_context: runtime_context("browser"),
        latest_user_text: "请看浏览器页面并引用证据".to_string(),
        persona: persona(),
        memory_prompt: memory_prompt().to_string(),
        accounting: accounting(),
        delivery_mode: Some(PromptDeliveryMode::Full),
        ..PromptPolicyInput::default()
    })
}

fn lean_report(previous_prompt_hash: String) -> PromptBuildReport {
    build_system_prompt_report(&PromptPolicyInput {
        runtime_context: runtime_context("general"),
        latest_user_text: "继续改代码并跑测试".to_string(),
        persona: persona(),
        memory_prompt: memory_prompt().to_string(),
        accounting: accounting(),
        delivery_mode: Some(PromptDeliveryMode::LeanExperimental),
        previous_runtime_contract: Some(
            serde_json::to_value(current_prompt_runtime_contract()).expect("contract json"),
        ),
        previous_prompt_hash: Some(previous_prompt_hash),
        ..PromptPolicyInput::default()
    })
}

fn prompt_projection(report: &PromptBuildReport) -> Value {
    json!({
        "promptMode": report.prompt_mode,
        "refreshReason": report.refresh_reason,
        "contract": report.contract,
        "stablePromptHash": report.stable_prompt_hash,
        "sectionHashes": report.section_hashes,
        "sections": report.sections,
        "sceneModules": report.scene_modules,
        "missedModuleRecovery": report.missed_module_recovery,
        "estimatedPromptTokens": report.estimated_prompt_tokens,
        "estimatedSavedTokens": report.estimated_saved_tokens,
        "omittedStableTokens": report.omitted_stable_tokens,
        "prefixCacheEligibleTokens": report.prefix_cache_eligible_tokens,
        "prompt": report.prompt,
    })
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).expect("snapshot json")
}

#[test]
fn full_prompt_report_snapshot() {
    let report = full_report();
    insta::assert_snapshot!("full_prompt_report", pretty(&prompt_projection(&report)));
}

#[test]
fn lean_prompt_report_snapshot() {
    let full = full_report();
    let report = lean_report(full.stable_prompt_hash);
    insta::assert_snapshot!("lean_prompt_report", pretty(&prompt_projection(&report)));
}
