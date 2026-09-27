//! Configuration-time recovery only. No chat replay or cross-vendor fallback.
use super::*;
use std::{
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};

pub(crate) struct Discovery {
    pub(crate) profile: NativeProviderProfile,
    pub(crate) models: Vec<NativeProviderModel>,
}

fn candidates(provider: &NativeProviderProfile) -> Vec<NativeProviderProfile> {
    let routes = route_descriptors();
    let Some(current) = routes.iter().find(|route| route.id == provider.route_id) else {
        return vec![provider.clone()];
    };
    // Custom gateways and custom auth headers remain explicit user choices.
    let is_official = provider
        .base_url
        .as_deref()
        .is_some_and(is_official_base_url);
    if !is_official
        || provider.auth_header.as_deref().is_some_and(|header| {
            !header.trim().is_empty()
                && !header.eq_ignore_ascii_case("api-key")
                && !header.eq_ignore_ascii_case("authorization")
        })
    {
        return vec![provider.clone()];
    }
    let key = transport::auth::resolve_api_key(provider).unwrap_or_default();
    let token_plan = if key.starts_with("tp-") || key.starts_with("ttp-") {
        true
    } else if key.starts_with("sk-") {
        false
    } else {
        return vec![provider.clone()];
    };
    let mut matching = routes
        .iter()
        .filter(|route| {
            route.protocol_id == current.protocol_id
                && route.id.contains("token_plan") == token_plan
        })
        .collect::<Vec<_>>();
    // Keep a working selected region. A key prefix cannot identify its region.
    matching.sort_by_key(|route| route.id != provider.route_id);
    matching
        .into_iter()
        .map(|route| {
            let mut candidate = provider.clone();
            candidate.route_id = route.id.clone();
            candidate.base_url = route.default_base_url.clone();
            candidate.auth_header = Some("api-key".to_string());
            candidate
        })
        .collect()
}

pub(crate) fn discover(
    provider: &NativeProviderProfile,
    prefer_fastest: bool,
) -> AgentRuntimeResult<Discovery> {
    let deadline = Instant::now() + Duration::from_secs(20);
    discover_with(provider, prefer_fastest, move |candidate| {
        let timeout = deadline.saturating_duration_since(Instant::now());
        if timeout.is_zero() {
            return Err(AgentRuntimeError::Core(
                "MiMo route verification timed out".to_string(),
            ));
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(timeout.min(Duration::from_secs(8)))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if is_anthropic_route(&candidate.route_id) {
            discover_anthropic_models_with_mimo_auth(&client, candidate)
        } else {
            discover_openai_models_with_mimo_auth(&client, candidate)
        }
    })
}

fn discover_with(
    provider: &NativeProviderProfile,
    prefer_fastest: bool,
    probe: impl Fn(&NativeProviderProfile) -> AgentRuntimeResult<Vec<NativeProviderModel>>
    + Send
    + Sync
    + 'static,
) -> AgentRuntimeResult<Discovery> {
    let mut routes = candidates(provider);
    let mut first_error = None;
    // Regular refreshes reuse a working saved route; only explicit setup races
    // all compatible regions. Authentication failure can re-resolve old setups.
    if !prefer_fastest
        && routes
            .iter()
            .any(|route| route.route_id == provider.route_id)
    {
        match probe(provider) {
            Ok(models) => {
                return Ok(Discovery {
                    profile: provider.clone(),
                    models,
                });
            }
            Err(error @ AgentRuntimeError::ProviderFailure { .. })
                if matches!(&error, AgentRuntimeError::ProviderFailure { failure }
                    if failure.http_status == Some(401)) =>
            {
                first_error = Some(error);
            }
            Err(error) => return Err(error),
        }
        routes.retain(|route| route.route_id != provider.route_id);
    }
    if routes.len() == 1 {
        let candidate = routes.remove(0);
        let models = probe(&candidate)?;
        if models.is_empty() && candidate.route_id != provider.route_id {
            return Err(empty_models_error());
        }
        return Ok(Discovery {
            profile: candidate,
            models,
        });
    }
    let probe = Arc::new(probe);
    let (sender, receiver) = mpsc::channel();
    for candidate in routes {
        let probe = probe.clone();
        let sender = sender.clone();
        // At most three read-only /models requests, each bounded to 8s. Return
        // on the first usable response without waiting for slower losers.
        std::thread::spawn(move || {
            let result = probe(&candidate);
            let _ = sender.send((candidate, result));
        });
    }
    drop(sender);
    let deadline = Instant::now() + Duration::from_secs(9);
    while let Ok((candidate, result)) =
        receiver.recv_timeout(deadline.saturating_duration_since(Instant::now()))
    {
        match result {
            Ok(models) if !models.is_empty() => {
                return Ok(Discovery {
                    profile: candidate,
                    models,
                });
            }
            result => {
                let error = result.err().unwrap_or_else(empty_models_error);
                if first_error.is_none() || candidate.route_id == provider.route_id {
                    first_error = Some(error);
                }
            }
        }
    }
    Err(first_error
        .unwrap_or_else(|| AgentRuntimeError::Core("No MiMo route could be verified".to_string())))
}

fn empty_models_error() -> AgentRuntimeError {
    AgentRuntimeError::Core(
        "MiMo returned no usable models; the selected route was not changed".to_string(),
    )
}

/// Copy only verified routing fields into the still-current stored profile.
/// Never persist the resolved secure-storage key used by discovery.
pub(crate) fn apply_verified_route(
    stored: &mut NativeProviderProfile,
    expected: &NativeProviderProfile,
    verified: &NativeProviderProfile,
) -> AgentRuntimeResult<Option<Value>> {
    if serde_json::to_value(&*stored).ok() != serde_json::to_value(expected).ok()
        || stored.api_key != expected.api_key
    {
        return Err(AgentRuntimeError::Core(
            "Provider configuration changed during discovery; please retry".to_string(),
        ));
    }
    if stored.route_id == verified.route_id && stored.base_url == verified.base_url {
        return Ok(None);
    }
    let from = registry::require_route(&stored.route_id)?;
    let to = registry::require_route(&verified.route_id)?;
    let adjustment = json!({
        "profileId": stored.id,
        "fromRouteId": from.id,
        "fromLabel": from.label,
        "toRouteId": to.id,
        "toLabel": to.label,
        "baseUrl": verified.base_url,
    });
    if stored.label == from.label {
        stored.label = to.label;
    }
    stored.route_id = verified.route_id.clone();
    stored.base_url = verified.base_url.clone();
    stored.auth_header = verified.auth_header.clone();
    Ok(Some(adjustment))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn profile(route: &str, key: &str) -> NativeProviderProfile {
        let descriptor = descriptor_for(route);
        NativeProviderProfile {
            id: "my-mimo".into(),
            label: descriptor.label,
            route_id: route.into(),
            base_url: descriptor.default_base_url,
            api_key: Some(key.into()),
            api_key_ref: None,
            api_key_env: None,
            auth_header: None,
            default_model: None,
            embedding_model: None,
            models: vec![],
        }
    }

    fn models() -> Vec<NativeProviderModel> {
        vec![model_capabilities::discovered_model(
            "mimo-v2.5-pro",
            None,
            None,
            None,
            None,
        )]
    }

    fn failure(provider: &NativeProviderProfile, status: u16) -> AgentRuntimeError {
        crate::native_backend::provider::provider_response_error_text(
            provider,
            reqwest::StatusCode::from_u16(status).unwrap(),
            r#"{"error":{"message":"test failure"}}"#,
            None,
        )
    }

    #[test]
    fn all_eight_selections_resolve_key_family_and_keep_protocol() {
        for route in route_descriptors() {
            for key in ["sk-test", "tp-test", "ttp-test"] {
                let candidates = candidates(&profile(&route.id, key));
                assert_eq!(candidates.len(), if key.starts_with("sk-") { 1 } else { 3 });
                for candidate in candidates {
                    let descriptor = descriptor_for(&candidate.route_id);
                    assert_eq!(descriptor.protocol_id, route.protocol_id);
                    assert_eq!(
                        candidate.route_id.contains("token_plan"),
                        !key.starts_with("sk-")
                    );
                    assert_eq!(candidate.base_url, descriptor.default_base_url);
                }
            }
        }
    }

    #[test]
    fn unknown_keys_custom_gateways_and_headers_are_not_sent_to_other_hosts() {
        let mut custom = profile(TOKEN_PLAN_SGP_ROUTE_ID, "tp-test");
        custom.base_url = Some("https://relay.example/v1".into());
        let mut custom_header = profile(PAY_AS_YOU_GO_ROUTE_ID, "tp-test");
        custom_header.auth_header = Some("x-team-key".into());
        for profile in [
            custom,
            custom_header,
            profile(PAY_AS_YOU_GO_ROUTE_ID, "future-format"),
        ] {
            let candidates = candidates(&profile);
            assert_eq!(candidates.len(), 1);
            assert_eq!(candidates[0].route_id, profile.route_id);
            assert_eq!(candidates[0].base_url, profile.base_url);
        }
    }

    #[test]
    fn fastest_valid_region_wins_without_waiting_for_slow_or_fast_invalid_region() {
        let (release, wait) = mpsc::channel::<()>();
        let wait = Mutex::new(wait);
        let selected = profile(PAY_AS_YOU_GO_ROUTE_ID, "tp-test");
        let discovered = discover_with(&selected, true, move |candidate| {
            match candidate.route_id.as_str() {
                TOKEN_PLAN_CN_ROUTE_ID => {
                    let _ = wait.lock().unwrap().recv_timeout(Duration::from_secs(2));
                    Ok(models())
                }
                TOKEN_PLAN_SGP_ROUTE_ID => Err(failure(candidate, 401)),
                TOKEN_PLAN_AMS_ROUTE_ID => Ok(models()),
                _ => panic!("unexpected candidate"),
            }
        })
        .unwrap();
        assert_eq!(discovered.profile.route_id, TOKEN_PLAN_AMS_ROUTE_ID);
        drop(release);
    }

    #[test]
    fn normal_refresh_reuses_verified_route_without_racing() {
        let selected = profile(TOKEN_PLAN_SGP_ROUTE_ID, "tp-test");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let observed = calls.clone();
        let result = discover_with(&selected, false, move |candidate| {
            observed.lock().unwrap().push(candidate.route_id.clone());
            Ok(models())
        })
        .unwrap();
        assert_eq!(result.profile.route_id, TOKEN_PLAN_SGP_ROUTE_ID);
        assert_eq!(*calls.lock().unwrap(), [TOKEN_PLAN_SGP_ROUTE_ID]);
    }

    #[test]
    fn authentication_failure_recovers_existing_configuration() {
        let selected = profile(TOKEN_PLAN_SGP_ROUTE_ID, "ttp-test");
        let result = discover_with(&selected, false, |candidate| {
            if candidate.route_id == TOKEN_PLAN_AMS_ROUTE_ID {
                Ok(models())
            } else {
                Err(failure(candidate, 401))
            }
        })
        .unwrap();
        assert_eq!(result.profile.route_id, TOKEN_PLAN_AMS_ROUTE_ID);
    }

    #[test]
    fn regular_refresh_does_not_treat_quota_or_access_errors_as_wrong_routes() {
        for status in [402, 403, 429, 500] {
            let selected = profile(TOKEN_PLAN_SGP_ROUTE_ID, "tp-test");
            let result = discover_with(&selected, false, move |candidate| {
                assert_eq!(candidate.route_id, TOKEN_PLAN_SGP_ROUTE_ID);
                Err(failure(candidate, status))
            });
            assert!(
                matches!(result, Err(AgentRuntimeError::ProviderFailure { failure }) if failure.http_status == Some(status))
            );
        }
    }

    #[test]
    fn all_invalid_and_empty_results_do_not_produce_a_route_adjustment() {
        let selected = profile(TOKEN_PLAN_SGP_ROUTE_ID, "tp-test");
        let error = discover_with(&selected, true, |candidate| Err(failure(candidate, 401)))
            .err()
            .unwrap();
        assert!(
            matches!(error, AgentRuntimeError::ProviderFailure { failure } if failure.route_id == TOKEN_PLAN_SGP_ROUTE_ID)
        );
        assert!(discover_with(&selected, true, |_| Ok(vec![])).is_err());
    }

    #[test]
    fn commit_preserves_profile_identity_secret_reference_and_model_settings() {
        let mut stored = profile(TOKEN_PLAN_SGP_ROUTE_ID, "tp-test");
        stored.api_key = None;
        stored.api_key_ref = Some(json!({"id": "secure-reference"}));
        stored.label = "My work account".into();
        stored.default_model = Some("mimo-v2.5-pro".into());
        stored.models = models();
        stored.models[0].enabled = false;
        let expected = stored.clone();
        let verified = profile(PAY_AS_YOU_GO_ROUTE_ID, "sk-resolved-secret");
        let adjustment = apply_verified_route(&mut stored, &expected, &verified)
            .unwrap()
            .unwrap();
        assert_eq!(stored.id, expected.id);
        assert_eq!(stored.label, expected.label);
        assert_eq!(stored.default_model, expected.default_model);
        assert!(!stored.models[0].enabled);
        assert!(stored.api_key.is_none());
        assert_eq!(stored.api_key_ref, expected.api_key_ref);
        assert_eq!(adjustment["toRouteId"], PAY_AS_YOU_GO_ROUTE_ID);
        assert!(!adjustment.to_string().contains("secret"));
        assert!(
            apply_verified_route(&mut stored.clone(), &stored, &verified)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn concurrent_edit_is_not_overwritten_by_discovery() {
        let original = profile(TOKEN_PLAN_SGP_ROUTE_ID, "tp-test");
        let mut edited = original.clone();
        edited.api_key = Some("tp-replaced".into());
        assert!(
            apply_verified_route(
                &mut edited,
                &original,
                &profile(TOKEN_PLAN_AMS_ROUTE_ID, "tp-test")
            )
            .is_err()
        );
        assert_eq!(edited.route_id, TOKEN_PLAN_SGP_ROUTE_ID);
        assert_eq!(edited.api_key.as_deref(), Some("tp-replaced"));
    }
}
