use super::*;

fn profile() -> NativeProviderProfile {
    serde_json::from_value(json!({
        "id": format!("scheduler-{}", Uuid::new_v4()),
        "label": "scheduler test", "routeId": "test"
    }))
    .expect("test profile")
}

fn occupancy(provider: &NativeProviderProfile) -> (usize, usize) {
    let state = provider_request_scheduler().state.lock().unwrap();
    let lane = &state[&provider_lane_key(provider, "test")];
    (lane.in_flight, lane.waiting.len())
}

#[tokio::test]
async fn dropping_an_in_flight_request_releases_its_slot() {
    let provider = profile();
    let cancellation = CancellationToken::new();
    let mut request = Box::pin(scheduled_provider_request_async(
        "session",
        &provider,
        "test",
        &cancellation,
        std::future::pending,
    ));
    assert!(futures::poll!(&mut request).is_pending());
    assert_eq!(occupancy(&provider), (1, 0));
    drop(request);
    assert_eq!(occupancy(&provider), (0, 0));
}

#[tokio::test]
async fn dropping_a_queued_request_does_not_block_the_following_request() {
    let provider = profile();
    let cancellation = CancellationToken::new();
    let first = acquire_provider_request_permit(&provider, "test", "session", &cancellation)
        .await
        .unwrap();
    let second = acquire_provider_request_permit(&provider, "test", "session", &cancellation)
        .await
        .unwrap();
    let mut abandoned = Box::pin(acquire_provider_request_permit(
        &provider,
        "test",
        "session",
        &cancellation,
    ));
    assert!(futures::poll!(&mut abandoned).is_pending());
    assert_eq!(occupancy(&provider), (2, 1));
    drop(abandoned);
    assert_eq!(occupancy(&provider), (2, 0));
    drop(first);
    let next = tokio::time::timeout(
        Duration::from_secs(1),
        acquire_provider_request_permit(&provider, "test", "session", &cancellation),
    )
    .await
    .expect("next request must not hang")
    .unwrap();
    assert_eq!(occupancy(&provider), (2, 0));
    drop((second, next));
    assert_eq!(occupancy(&provider), (0, 0));
}

#[tokio::test]
async fn completed_requests_release_exactly_once_and_queued_cancellation_cleans_up() {
    let provider = profile();
    let cancellation = CancellationToken::new();
    let first = acquire_provider_request_permit(&provider, "test", "session", &cancellation)
        .await
        .unwrap();
    let result =
        scheduled_provider_request_async("session", &provider, "test", &cancellation, || async {
            Err(AgentRuntimeError::Cancelled)
        })
        .await;
    assert!(matches!(result, Err(AgentRuntimeError::Cancelled)));
    assert_eq!(occupancy(&provider), (1, 0));
    let second = acquire_provider_request_permit(&provider, "test", "session", &cancellation)
        .await
        .unwrap();
    let queued_cancellation = CancellationToken::new();
    let mut queued = Box::pin(acquire_provider_request_permit(
        &provider,
        "test",
        "session",
        &queued_cancellation,
    ));
    assert!(futures::poll!(&mut queued).is_pending());
    queued_cancellation.cancel();
    assert!(matches!(queued.await, Err(AgentRuntimeError::Cancelled)));
    assert_eq!(occupancy(&provider), (2, 0));
    drop((first, second));
    assert_eq!(occupancy(&provider), (0, 0));
}
