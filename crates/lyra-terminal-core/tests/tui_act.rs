use lyra_terminal_core::{tui_act, tui_map, TerminalScreenRegion, TerminalScreenState};

fn wizard_regions() -> (String, Vec<TerminalScreenRegion>) {
    let mut state = TerminalScreenState::new(6, 48);
    state.feed(b"? Choose package manager\n  npm\n> pnpm\n  yarn");
    let snapshot = state.snapshot(false, Some(6), Some(4096));
    let cursor = snapshot.cursor.clone();
    let regions = tui_map::regions_from_snapshot(&snapshot, Some(64), true).0;
    (cursor, regions)
}

#[test]
fn select_maps_to_semantic_select_region() {
    let (cursor, regions) = wizard_regions();
    let target = regions
        .iter()
        .find(|region| region.kind == "menu_item" && region.text.contains("pnpm"))
        .expect("menu item");
    let plan = tui_act::resolve_plan(
        tui_act::TuiActContext {
            current_screen_cursor: &cursor,
            regions: &regions,
        },
        tui_act::TuiActRequest {
            action: "select".to_string(),
            region_id: Some(target.region_id.clone()),
            screen_cursor: Some(cursor.clone()),
            text: None,
            direction: None,
            amount: None,
            reason: Some("choose package manager".to_string()),
        },
    )
    .expect("select plan");

    assert_eq!(plan.input_action, "selectRegion");
    assert_eq!(plan.region_id.as_deref(), Some(target.region_id.as_str()));
    assert_eq!(plan.risk, "low");
}

#[test]
fn confirm_and_cancel_map_to_portable_key_actions() {
    let (cursor, regions) = wizard_regions();
    let confirm = tui_act::resolve_plan(
        tui_act::TuiActContext {
            current_screen_cursor: &cursor,
            regions: &regions,
        },
        tui_act::TuiActRequest {
            action: "confirm".to_string(),
            region_id: None,
            screen_cursor: Some(cursor.clone()),
            text: None,
            direction: None,
            amount: None,
            reason: None,
        },
    )
    .expect("confirm plan");
    let cancel = tui_act::resolve_plan(
        tui_act::TuiActContext {
            current_screen_cursor: &cursor,
            regions: &regions,
        },
        tui_act::TuiActRequest {
            action: "cancel".to_string(),
            region_id: None,
            screen_cursor: Some(cursor.clone()),
            text: None,
            direction: None,
            amount: None,
            reason: None,
        },
    )
    .expect("cancel plan");

    assert_eq!(confirm.input_action, "submitInput");
    assert_eq!(confirm.keys, vec!["enter"]);
    assert_eq!(cancel.input_action, "pressKeys");
    assert_eq!(cancel.keys, vec!["escape"]);
}

#[test]
fn stale_screen_cursor_returns_stale_target_error() {
    let (_cursor, regions) = wizard_regions();
    let error = tui_act::resolve_plan(
        tui_act::TuiActContext {
            current_screen_cursor: "8",
            regions: &regions,
        },
        tui_act::TuiActRequest {
            action: "confirm".to_string(),
            region_id: None,
            screen_cursor: Some("7".to_string()),
            text: None,
            direction: None,
            amount: None,
            reason: None,
        },
    )
    .expect_err("stale target");

    assert_eq!(error.kind, tui_act::TuiActErrorKind::StaleTarget);
}

#[test]
fn type_and_scroll_actions_are_planned_without_raw_bytes() {
    let (cursor, regions) = wizard_regions();
    let typed = tui_act::resolve_plan(
        tui_act::TuiActContext {
            current_screen_cursor: &cursor,
            regions: &regions,
        },
        tui_act::TuiActRequest {
            action: "type".to_string(),
            region_id: None,
            screen_cursor: Some(cursor.clone()),
            text: Some("hello".to_string()),
            direction: None,
            amount: None,
            reason: None,
        },
    )
    .expect("type plan");
    let scroll = tui_act::resolve_plan(
        tui_act::TuiActContext {
            current_screen_cursor: &cursor,
            regions: &regions,
        },
        tui_act::TuiActRequest {
            action: "scroll".to_string(),
            region_id: None,
            screen_cursor: Some(cursor.clone()),
            text: None,
            direction: Some("pageDown".to_string()),
            amount: Some(2),
            reason: None,
        },
    )
    .expect("scroll plan");

    assert_eq!(typed.input_action, "pasteText");
    assert_eq!(typed.text.as_deref(), Some("hello"));
    assert_eq!(scroll.input_action, "pressKeys");
    assert_eq!(scroll.keys, vec!["page_down", "page_down"]);
}
