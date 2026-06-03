use lyra_terminal_core::{tui_map, TerminalScreenState};

fn mapped_regions(state: &TerminalScreenState) -> Vec<lyra_terminal_core::TerminalScreenRegion> {
    let snapshot = state.snapshot(false, Some(12), Some(16 * 1024));
    tui_map::regions_from_snapshot(&snapshot, Some(64), true).0
}

#[test]
fn detects_common_regions_on_normal_screen() {
    let mut state = TerminalScreenState::new(10, 80);
    state.feed(
        b"\x1b]633;LyraPrompt\x07lyra % npm create vite\r\n? Choose framework\r\n  React\r\n> Svelte\r\n[info] ready\r\nError: missing template",
    );

    let regions = mapped_regions(&state);

    assert!(regions
        .iter()
        .any(|region| region.kind == "prompt" && region.text.contains("lyra %")));
    assert!(regions
        .iter()
        .any(|region| region.kind == "input"
            && region.suggested_actions.contains(&"type".to_string())));
    assert!(regions
        .iter()
        .any(|region| region.kind == "menu_item" && region.text.contains("Svelte")));
    assert!(regions
        .iter()
        .any(|region| region.kind == "log" && region.text.contains("ready")));
    assert!(regions
        .iter()
        .any(|region| region.kind == "error" && region.text.contains("missing")));
}

#[test]
fn detects_regions_on_alternate_screen() {
    let mut state = TerminalScreenState::new(8, 60);
    state.feed(b"\x1b[?1049h\x1b[H\x1b[2J");
    state.feed(b"? Pick target\n  alpha\n\x1b[7m> beta\x1b[0m\n  gamma\n\x1b[8;1H-- INSERT --");
    let snapshot = state.snapshot(false, Some(8), Some(16 * 1024));
    let (regions, truncated) = tui_map::regions_from_snapshot(&snapshot, Some(64), true);

    assert!(!truncated);
    assert_eq!(snapshot.mode, "alternate");
    assert!(regions
        .iter()
        .any(|region| region.kind == "selection" && region.text.contains("beta")));
    assert!(regions
        .iter()
        .any(|region| region.kind == "menu_item" && region.text.contains("beta")));
    assert!(regions
        .iter()
        .any(|region| region.kind == "status" && region.text.contains("INSERT")));
}

#[test]
fn region_ids_are_stable_within_one_screen_version() {
    let mut state = TerminalScreenState::new(6, 48);
    state.feed(b"? Choose package manager\n  npm\n> pnpm\n  yarn");
    let snapshot = state.snapshot(false, Some(6), Some(4096));
    let first = tui_map::regions_from_snapshot(&snapshot, Some(64), true).0;
    let second = tui_map::regions_from_snapshot(&snapshot, Some(64), true).0;

    let first_ids = first
        .iter()
        .map(|region| region.region_id.clone())
        .collect::<Vec<_>>();
    let second_ids = second
        .iter()
        .map(|region| region.region_id.clone())
        .collect::<Vec<_>>();
    assert_eq!(first_ids, second_ids);
    assert!(first_ids.iter().all(|id| id.starts_with("sv")));
}

#[test]
fn region_output_is_budgeted_and_can_omit_text() {
    let mut state = TerminalScreenState::new(12, 60);
    state.feed(
        b"? Choose\n  one\n  two\n> three\n[ ] alpha\n[x] beta\n( ) red\n(*) blue\nError: nope\n[info] line",
    );
    let snapshot = state.snapshot(false, Some(12), Some(4096));
    let (regions, truncated) = tui_map::regions_from_snapshot(&snapshot, Some(3), false);

    assert!(truncated);
    assert_eq!(regions.len(), 3);
    assert!(regions.iter().all(|region| region.text.is_empty()));
}

#[test]
fn stale_cursor_warning_reports_current_cursor() {
    let warning = tui_map::stale_cursor_warning(Some("3"), "4").expect("warning");
    assert!(warning.contains("requested 3"));
    assert!(warning.contains("current 4"));
    assert!(tui_map::stale_cursor_warning(Some("4"), "4").is_none());
}
