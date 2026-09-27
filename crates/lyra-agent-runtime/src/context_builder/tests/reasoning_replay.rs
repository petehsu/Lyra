use super::*;

fn options() -> ProviderContextOptions {
    ProviderContextOptions {
        provider_id: Some("deepseek".into()),
        route_id: Some("deepseek".into()),
        protocol_id: Some("openai_chat_completions".into()),
        model: Some("deepseek-flash".into()),
        ..Default::default()
    }
}

fn stored_message() -> Value {
    json!({"role":"assistant","text":"answer","reasoningContent":"original thought","metadata":{
        "providerProtocol":{
            "version":2,"turnId":"turn-1","status":"complete",
            "origin":{"providerId":"deepseek","routeId":"deepseek","protocolId":"openai_chat_completions","model":"deepseek-flash"},
            "assistant":{"content":"answer","toolCalls":[]},
            "replay":{"protocol":"openai_chat_completions","items":[{"field":"reasoning_content","value":null}]}
        }
    }})
}

fn build(message: Value, options: ProviderContextOptions) -> ProviderContext {
    ContextBuilder::default().build_provider_context("system".into(), vec![message], options)
}

#[test]
fn reasoning_replay_repairs_old_null_without_mutating_saved_message() {
    let message = stored_message();
    let original = message.clone();
    let context = build(message.clone(), options());
    assert_eq!(context.messages[1]["reasoning_content"], "original thought");
    assert_eq!(
        context.messages[1]["lyraProviderReplay"]["items"][0]["value"],
        "original thought"
    );
    assert_eq!(message, original);
    for (field, value) in [
        ("providerId", "other"),
        ("routeId", "other"),
        ("protocolId", "other"),
        ("model", "other"),
    ] {
        let mut foreign = message.clone();
        foreign["metadata"]["providerProtocol"]["origin"][field] = json!(value);
        let serialized = serde_json::to_string(&build(foreign, options()).messages).unwrap();
        assert!(
            !serialized.contains("original thought"),
            "origin field {field}"
        );
    }
}

#[test]
fn reasoning_replay_repairs_each_prior_step_from_its_exact_transcript_only() {
    let mut message = stored_message();
    let mut prior = message["metadata"]["providerProtocol"].clone();
    prior["assistant"] =
        json!({"content":"","toolCalls":[{"id":"call-a","name":"read_file","arguments":{}}]});
    prior["toolResults"] = json!([{"toolCallId":"call-a","content":"evidence"}]);
    message["metadata"]["providerProtocol"]["priorSteps"] = json!([prior]);
    message["metadata"]["providerTranscript"] = json!([
        {"role":"assistant","content":"","tool_calls":[{"id":"different-call"}],"reasoning_content":"wrong thought"},
        {"role":"assistant","content":"","tool_calls":[{"id":"call-a"}],"reasoning_content":"tool thought"},
        {"role":"assistant","content":"answer","reasoning_content":"final thought"}
    ]);
    let context = build(message.clone(), options());
    assert_eq!(context.messages[1]["reasoning_content"], "tool thought");
    assert_eq!(context.messages[3]["reasoning_content"], "final thought");
    message["metadata"]
        .as_object_mut()
        .unwrap()
        .remove("providerTranscript");
    let context = build(message, options());
    assert!(context.messages[1].get("reasoning_content").is_none());
    assert!(
        context.messages[3].get("reasoning_content").is_none(),
        "merged UI reasoning is not attributable to one step"
    );
}

#[test]
fn reasoning_replay_preserves_empty_native_values_and_never_fabricates_signatures() {
    let mut message = stored_message();
    message["metadata"]["providerProtocol"]["replay"]["items"][0]["value"] = json!("");
    assert_eq!(
        build(message.clone(), options()).messages[1]["reasoning_content"],
        ""
    );
    message["metadata"]["providerProtocol"]["replay"]["items"] = json!([
        {"field":"reasoning","value":"native text"},
        {"field":"reasoning_details","value":[{"type":"reasoning.encrypted","data":"opaque","signature":"sig"}]}
    ]);
    let context = build(message.clone(), options());
    assert_eq!(
        context.messages[1]["reasoning_details"][0]["signature"],
        "sig"
    );
    assert_eq!(context.messages[1]["reasoning"], "native text");
    message["metadata"]["providerProtocol"]["replay"]["items"] =
        json!([{"field":"reasoning_details","value":null}]);
    assert!(
        build(message, options()).messages[1]
            .get("reasoning_details")
            .is_none()
    );
}

#[test]
fn reasoning_replay_does_not_relabel_a_foreign_protocol_payload() {
    for protocol in ["anthropic_messages", "openai_responses"] {
        let mut message = stored_message();
        message["metadata"]["providerProtocol"]["replay"]["protocol"] = json!(protocol);
        let context = build(message, options());
        assert_eq!(context.messages[1]["content"], "answer");
        assert!(context.messages[1].get("reasoning_content").is_none());
        assert!(context.messages[1].get("lyraProviderReplay").is_none());
    }
}
