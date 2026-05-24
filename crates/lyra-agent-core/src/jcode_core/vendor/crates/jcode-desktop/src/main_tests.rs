use super::animation::{FOCUS_PULSE_DURATION, VIEWPORT_ANIMATION_DURATION};
use super::single_session::*;
use super::*;

#[test]
fn quarter_size_preset_follows_quarter_screen_width_steps() {
    let monitor_width = Some(2000);

    assert_eq!(inferred_visible_column_count(500, monitor_width, 0.25), 1);
    assert_eq!(inferred_visible_column_count(1000, monitor_width, 0.25), 2);
    assert_eq!(inferred_visible_column_count(1500, monitor_width, 0.25), 3);
    assert_eq!(inferred_visible_column_count(2000, monitor_width, 0.25), 4);
}

#[test]
fn preferred_panel_size_limits_visible_column_count() {
    let monitor_width = Some(2000);

    assert_eq!(inferred_visible_column_count(2000, monitor_width, 0.25), 4);
    assert_eq!(inferred_visible_column_count(2000, monitor_width, 0.50), 2);
    assert_eq!(inferred_visible_column_count(2000, monitor_width, 0.75), 1);
    assert_eq!(inferred_visible_column_count(2000, monitor_width, 1.00), 1);

    assert_eq!(inferred_visible_column_count(500, monitor_width, 0.25), 1);
    assert_eq!(inferred_visible_column_count(500, monitor_width, 1.00), 1);
}

#[test]
fn visible_column_count_tolerates_window_manager_gaps() {
    let monitor_width = Some(2000);

    assert_eq!(inferred_visible_column_count(1940, monitor_width, 0.25), 4);
    assert_eq!(inferred_visible_column_count(970, monitor_width, 0.25), 2);
    assert_eq!(inferred_visible_column_count(1940, monitor_width, 0.50), 2);
}

#[test]
fn visible_column_count_is_clamped_and_safe_without_monitor() {
    assert_eq!(inferred_visible_column_count(1, Some(2000), 0.25), 1);
    assert_eq!(inferred_visible_column_count(3000, Some(2000), 0.25), 4);
    assert_eq!(inferred_visible_column_count(1000, Some(0), 0.25), 1);
    assert_eq!(inferred_visible_column_count(1000, None, 0.25), 1);
}

#[test]
fn workspace_status_text_includes_build_hash() {
    let mut workspace = Workspace::fake();

    assert_eq!(
        workspace_status_text(&workspace),
        format!("NAV P25 {}", desktop_build_hash_label())
    );

    workspace.mode = InputMode::Insert;
    assert_eq!(
        workspace_status_text(&workspace),
        format!("INS P25 {}", desktop_build_hash_label())
    );
}

#[test]
fn viewport_animation_interpolates_to_new_layout_target() {
    let mut animation = AnimatedViewport::default();
    let now = Instant::now();
    let visible = VisibleColumnLayout {
        visible_columns: 2,
        first_visible_column: 0,
    };
    let start = WorkspaceRenderLayout {
        visible,
        column_width: 200.0,
        scroll_offset: 0.0,
        vertical_scroll_offset: 0.0,
    };
    let target = WorkspaceRenderLayout {
        visible: VisibleColumnLayout {
            visible_columns: 2,
            first_visible_column: 2,
        },
        column_width: 300.0,
        scroll_offset: 600.0,
        vertical_scroll_offset: 800.0,
    };

    let first_frame = animation.frame(start, now);
    assert_eq!(first_frame.column_width, 200.0);
    assert_eq!(first_frame.scroll_offset, 0.0);
    assert_eq!(first_frame.vertical_scroll_offset, 0.0);
    assert!(!animation.is_animating());

    let transition_start = animation.frame(target, now);
    assert_eq!(transition_start.column_width, 200.0);
    assert_eq!(transition_start.scroll_offset, 0.0);
    assert_eq!(transition_start.vertical_scroll_offset, 0.0);
    assert!(animation.is_animating());

    let middle = animation.frame(target, now + VIEWPORT_ANIMATION_DURATION / 2);
    assert!(middle.column_width > 200.0);
    assert!(middle.column_width < 300.0);
    assert!(middle.scroll_offset > 0.0);
    assert!(middle.scroll_offset < 600.0);
    assert!(middle.vertical_scroll_offset > 0.0);
    assert!(middle.vertical_scroll_offset < 800.0);

    let final_frame = animation.frame(target, now + VIEWPORT_ANIMATION_DURATION);
    assert_eq!(final_frame.column_width, 300.0);
    assert_eq!(final_frame.scroll_offset, 600.0);
    assert_eq!(final_frame.vertical_scroll_offset, 800.0);
    assert!(!animation.is_animating());
}

#[test]
fn focus_pulse_runs_when_focused_surface_changes() {
    let mut pulse = FocusPulse::default();
    let now = Instant::now();

    assert_eq!(pulse.frame(1, now), 0.0);
    assert!(!pulse.is_animating());

    let start = pulse.frame(2, now);
    assert!(start > 0.0);
    assert!(pulse.is_animating());

    let middle = pulse.frame(2, now + FOCUS_PULSE_DURATION / 2);
    assert!(middle > 0.0);
    assert!(middle < start);

    let end = pulse.frame(2, now + FOCUS_PULSE_DURATION);
    assert_eq!(end, 0.0);
    assert!(!pulse.is_animating());
}

#[test]
fn bitmap_text_normalization_sanitizes_panel_titles() {
    assert_eq!(
        normalize_bitmap_text("fox · coordinator"),
        "FOX COORDINATOR"
    );
    assert_eq!(normalize_bitmap_text("agent-12"), "AGENT-12");
    assert_eq!(bitmap_text_width("NAV", 2.0), 34.0);
}

#[test]
fn bitmap_text_wrapping_breaks_on_words() {
    assert_eq!(
        wrap_bitmap_text("ONE TWO THREE", 1.0, bitmap_char_advance(1.0) * 7.0),
        vec!["ONE TWO", "THREE"]
    );
}

#[test]
fn bitmap_text_wrapping_splits_long_words() {
    assert_eq!(
        wrap_bitmap_text("ABCDEFGHI", 1.0, bitmap_char_advance(1.0) * 4.0),
        vec!["ABCD", "EFGH", "I"]
    );
}

#[test]
fn single_session_typography_targets_jetbrains_mono_light_nerd() {
    assert_eq!(SINGLE_SESSION_FONT_FAMILY, "JetBrainsMono Nerd Font");
    assert_eq!(SINGLE_SESSION_FONT_WEIGHT, "Light");
    assert!(SINGLE_SESSION_FONT_FALLBACKS.contains(&"monospace"));
    assert_eq!(SINGLE_SESSION_DEFAULT_FONT_SIZE, 22.0);
    assert_eq!(
        SINGLE_SESSION_TITLE_FONT_SIZE,
        SINGLE_SESSION_DEFAULT_FONT_SIZE
    );
    assert_eq!(
        SINGLE_SESSION_BODY_FONT_SIZE,
        SINGLE_SESSION_CODE_FONT_SIZE * 1.5
    );
    assert_eq!(
        SINGLE_SESSION_META_FONT_SIZE,
        SINGLE_SESSION_DEFAULT_FONT_SIZE
    );
    assert_eq!(
        SINGLE_SESSION_CODE_FONT_SIZE,
        SINGLE_SESSION_DEFAULT_FONT_SIZE + 3.0
    );
    assert!(SINGLE_SESSION_BODY_LINE_HEIGHT > SINGLE_SESSION_CODE_LINE_HEIGHT);
    assert!(SINGLE_SESSION_CODE_LINE_HEIGHT > SINGLE_SESSION_META_LINE_HEIGHT);
}

#[test]
fn single_session_vertices_include_a_draft_caret() {
    let mut app = SingleSessionApp::new(None);
    let empty_vertices = build_single_session_vertices(&app, PhysicalSize::new(640, 480), 0.0, 0);
    app.handle_key(KeyInput::Character("abc".to_string()));
    let mut typed_vertices =
        build_single_session_vertices(&app, PhysicalSize::new(640, 480), 0.0, 0);
    push_single_session_caret(&mut typed_vertices, &app, PhysicalSize::new(640, 480), None);

    assert!(!empty_vertices.is_empty());
    assert!(
        typed_vertices
            .iter()
            .any(|vertex| vertex.color == SINGLE_SESSION_CARET_COLOR)
    );
}

#[test]
fn single_session_vertices_do_not_draw_input_underline() {
    let fresh_app = SingleSessionApp::new(None);
    let fresh_vertices =
        build_single_session_vertices(&fresh_app, PhysicalSize::new(900, 700), 0.0, 0);
    let mut app = SingleSessionApp::new(None);
    app.apply_session_event(session_launch::DesktopSessionEvent::SessionStarted {
        session_id: "composer_line".to_string(),
    });
    let vertices = build_single_session_vertices(&app, PhysicalSize::new(900, 700), 0.0, 0);
    let old_composer_line_color = [0.060, 0.085, 0.145, 0.34];
    let outline_color = panel_accent_color(single_session_surface(None).color_index, true);

    assert!(!vertices_have_color(&vertices, old_composer_line_color));
    assert!(!vertices_have_color(
        &fresh_vertices,
        old_composer_line_color
    ));
    assert!(!vertices_have_bottom_center_rule(&vertices, outline_color));
    assert!(!vertices_have_bottom_center_rule(
        &fresh_vertices,
        outline_color
    ));
}

fn vertices_have_bottom_center_rule(vertices: &[Vertex], color: [f32; 4]) -> bool {
    vertices.iter().any(|vertex| {
        vertex.color == color && vertex.position[1] <= -0.99 && vertex.position[0].abs() < 0.85
    })
}

#[test]
fn fresh_single_session_restores_dominant_welcome_hero_without_input_hline() {
    let mut app = SingleSessionApp::new(None);
    let size = PhysicalSize::new(900, 700);
    let tick_zero = build_single_session_vertices(&app, size, 0.0, 0);

    assert!(vertices_have_color(&tick_zero, WELCOME_AURORA_BLUE));
    assert!(vertices_have_color(&tick_zero, WELCOME_HANDWRITING_COLOR));
    assert!(!vertices_have_color(
        &tick_zero,
        [0.060, 0.085, 0.145, 0.34]
    ));

    app.handle_key(KeyInput::Character("hello".to_string()));
    let typed = build_single_session_vertices(&app, size, 0.0, 18);
    assert!(vertices_have_color(&typed, WELCOME_AURORA_BLUE));
    assert!(!vertices_have_color(&typed, [0.060, 0.085, 0.145, 0.34]));
}

#[test]
fn fresh_single_session_offers_crashed_recovery_without_auto_opening() {
    let mut app = SingleSessionApp::new(None);
    app.set_recovery_session_count(3);

    let lines = app.body_styled_lines();
    let body = lines
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(body.contains("Found 3 crashed session(s)"));
    assert!(body.contains("Press Ctrl+R"));
    assert_eq!(
        app.handle_key(KeyInput::RefreshSessions),
        KeyOutcome::RestoreCrashedSessions
    );
}

#[test]
fn fresh_single_session_without_crashes_keeps_refresh_as_redraw() {
    let mut app = SingleSessionApp::new(None);

    assert_eq!(
        app.handle_key(KeyInput::RefreshSessions),
        KeyOutcome::Redraw
    );
    assert!(
        !app.body_styled_lines()
            .iter()
            .any(|line| line.text.contains("crashed session"))
    );
}

#[test]
fn single_session_active_work_uses_native_spinner_geometry() {
    let mut app = SingleSessionApp::new(None);
    let idle = build_single_session_vertices(&app, PhysicalSize::new(900, 700), 0.0, 0);
    assert!(!vertices_have_color(&idle, NATIVE_SPINNER_HEAD_COLOR));

    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "streaming".to_string(),
    ));
    let tick_zero = build_single_session_vertices(&app, PhysicalSize::new(900, 700), 0.0, 0);
    let tick_one = build_single_session_vertices(&app, PhysicalSize::new(900, 700), 0.0, 1);

    assert!(vertices_have_color(&tick_zero, NATIVE_SPINNER_HEAD_COLOR));
    assert!(vertices_have_color(&tick_one, NATIVE_SPINNER_HEAD_COLOR));
    assert_ne!(
        positions_for_color(&tick_zero, NATIVE_SPINNER_HEAD_COLOR),
        positions_for_color(&tick_one, NATIVE_SPINNER_HEAD_COLOR)
    );
}

#[test]
fn single_session_streaming_response_does_not_draw_line_reveal_shimmer() {
    let mut app = SingleSessionApp::new(None);
    let size = PhysicalSize::new(900, 700);
    const REMOVED_SHIMMER_SOFT_COLOR: [f32; 4] = [0.220, 0.520, 0.780, 0.055];
    const REMOVED_SHIMMER_CORE_COLOR: [f32; 4] = [0.220, 0.520, 0.780, 0.115];

    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "streaming answer".to_string(),
    ));
    let vertices = build_single_session_vertices(&app, size, 0.0, 0);

    assert!(!vertices_have_color(&vertices, REMOVED_SHIMMER_SOFT_COLOR));
    assert!(!vertices_have_color(&vertices, REMOVED_SHIMMER_CORE_COLOR));
}

#[test]
fn single_session_ctrl_backspace_deletes_previous_word() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello desktop world".to_string()));

    assert_eq!(
        app.handle_key(KeyInput::DeletePreviousWord),
        KeyOutcome::Redraw
    );
    assert_eq!(app.draft, "hello desktop ");
}

#[test]
fn single_session_supports_tui_like_word_movement_delete_and_undo() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello desktop world".to_string()));

    assert_eq!(
        app.handle_key(KeyInput::MoveCursorWordLeft),
        KeyOutcome::Redraw
    );
    assert_eq!(app.draft_cursor, "hello desktop ".len());

    assert_eq!(
        app.handle_key(KeyInput::MoveCursorWordRight),
        KeyOutcome::Redraw
    );
    assert_eq!(app.draft_cursor, app.draft.len());

    app.handle_key(KeyInput::MoveCursorWordLeft);
    assert_eq!(app.handle_key(KeyInput::DeleteNextWord), KeyOutcome::Redraw);
    assert_eq!(app.draft, "hello desktop ");

    assert_eq!(app.handle_key(KeyInput::UndoInput), KeyOutcome::Redraw);
    assert_eq!(app.draft, "hello desktop world");
}

#[test]
fn single_session_cursor_editing_inserts_and_deletes_in_middle() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("helo".to_string()));
    app.handle_key(KeyInput::MoveCursorLeft);
    app.handle_key(KeyInput::Character("l".to_string()));

    assert_eq!(app.draft, "hello");
    assert_eq!(app.draft_cursor, 4);

    app.handle_key(KeyInput::DeleteNextChar);
    assert_eq!(app.draft, "hell");
}

#[test]
fn single_session_composer_uses_next_prompt_number_and_status_footer() {
    let mut app = SingleSessionApp::new(None);
    assert_eq!(app.next_prompt_number(), 1);
    assert_eq!(app.composer_prompt(), "1› ");
    assert_eq!(app.composer_text(), "1› ");
    assert!(app.composer_status_line().contains("ready"));
    assert!(app.composer_status_line().contains("Ctrl+Enter queue/send"));
    assert!(!app.composer_status_line().contains("scrolled up"));

    app.scroll_body_lines(1.0);
    assert!(app.composer_status_line().contains("scrolled up 1 line"));
    app.scroll_body_lines(2.0);
    assert!(app.composer_status_line().contains("scrolled up 3 lines"));
    app.scroll_body_to_bottom();
    assert!(!app.composer_status_line().contains("scrolled up"));

    app.handle_key(KeyInput::Character("hello".to_string()));
    assert_eq!(app.composer_text(), "1› hello");
    assert_eq!(app.composer_cursor_line_byte_index(), (0, "1› hello".len()));
    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::StartFreshSession {
            message: "hello".to_string(),
            images: Vec::new()
        }
    );

    assert_eq!(app.next_prompt_number(), 2);
    assert_eq!(app.composer_text(), "2› ");
    assert!(app.composer_status_line().contains("Esc interrupt"));
}

#[test]
fn single_session_slash_help_opens_help_without_sending_prompt() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("/help".to_string()));

    assert_eq!(app.handle_key(KeyInput::SubmitDraft), KeyOutcome::Redraw);
    assert!(app.show_help);
    assert!(app.draft.is_empty());
    assert!(app.messages.is_empty());
    let help = app
        .inline_widget_styled_lines()
        .into_iter()
        .map(|line| line.text)
        .collect::<Vec<_>>()
        .join("\n");
    assert!(help.contains("slash commands"));
    assert!(help.contains("/model [name]"));
}

#[test]
fn single_session_info_hotkey_toggles_inline_session_stats() {
    let mut app = SingleSessionApp::new(Some(test_session_card(
        "session_info_1234567890",
        "Info Session",
        "ready",
    )));
    app.messages
        .push(SingleSessionMessage::user("what happened?"));
    app.messages
        .push(SingleSessionMessage::assistant("a useful answer"));
    app.messages.push(SingleSessionMessage::tool("read file"));
    app.streaming_response = "still streaming".to_string();
    app.status = Some("receiving".to_string());
    app.model_picker.current_model = Some("claude-sonnet-4-5".to_string());
    app.model_picker.provider_name = Some("Claude".to_string());

    assert_eq!(
        app.handle_key(KeyInput::ToggleSessionInfo),
        KeyOutcome::Redraw
    );
    assert!(app.show_session_info);
    let info = app
        .inline_widget_styled_lines()
        .into_iter()
        .map(|line| line.text)
        .collect::<Vec<_>>()
        .join("\n");
    assert!(info.contains("session info"));
    assert!(info.contains("Info Session"));
    assert!(info.contains("session_info_1234567890"));
    assert!(info.contains("receiving"));
    assert!(info.contains("Claude · claude-sonnet-4-5"));
    assert!(info.contains("3 total · 1 user · 1 assistant · 1 tool"));
    assert!(info.contains("streaming 15 chars"));

    assert_eq!(app.handle_key(KeyInput::Escape), KeyOutcome::Redraw);
    assert!(!app.show_session_info);
    assert!(app.inline_widget_styled_lines().is_empty());
}

#[test]
fn single_session_status_slash_opens_inline_session_info() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("/status".to_string()));

    assert_eq!(app.handle_key(KeyInput::SubmitDraft), KeyOutcome::Redraw);
    assert!(app.show_session_info);
    assert!(app.draft.is_empty());
    assert!(
        app.messages.is_empty(),
        "/status should not append a transcript meta row"
    );
    let info = app
        .inline_widget_styled_lines()
        .into_iter()
        .map(|line| line.text)
        .collect::<Vec<_>>()
        .join("\n");
    assert!(info.contains("fresh / not started"));
    assert!(info.contains("tokens"));
}

#[test]
fn single_session_slash_model_with_argument_requests_model_switch() {
    let mut app = SingleSessionApp::new(None);
    app.draft = "/model gpt-5.5".to_string();
    app.draft_cursor = app.draft.len();

    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::SetModel("gpt-5.5".to_string())
    );
    assert!(app.draft.is_empty());
    assert!(app.messages.is_empty());
}

#[test]
fn single_session_typing_model_slash_opens_preview_picker_without_submitting() {
    let mut app = SingleSessionApp::new(None);

    assert_eq!(
        app.handle_key(KeyInput::Character("/model opus".to_string())),
        KeyOutcome::LoadModelCatalog
    );
    assert!(app.model_picker.open);
    assert!(app.model_picker.preview);
    assert_eq!(app.draft, "/model opus");
    assert_eq!(app.model_picker.filter, "opus");

    app.apply_session_event(session_launch::DesktopSessionEvent::ModelCatalog {
        current_model: Some("claude-sonnet-4-5".to_string()),
        provider_name: Some("Claude".to_string()),
        models: vec![session_launch::DesktopModelChoice {
            model: "claude-opus-4-5".to_string(),
            provider: Some("claude".to_string()),
            api_method: Some("oauth".to_string()),
            detail: Some("premium".to_string()),
            available: true,
        }],
    });

    let body = app.body_lines().join("\n");
    assert!(!body.contains("MODEL"));
    let picker = app
        .inline_widget_styled_lines()
        .into_iter()
        .map(|line| line.text)
        .collect::<Vec<_>>()
        .join("\n");
    assert!(picker.contains("MODEL"));
    assert!(picker.contains("PROVIDER"));
    assert!(picker.contains("METHOD"));
    assert!(picker.contains("\"opus\""));

    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::SetModel("claude-opus-4-5".to_string())
    );
    assert!(!app.model_picker.open);
    assert!(app.draft.is_empty());
    assert!(app.messages.is_empty());
}

#[test]
fn single_session_unknown_slash_command_stays_local() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("/definitely-not-real".to_string()));

    assert_eq!(app.handle_key(KeyInput::SubmitDraft), KeyOutcome::Redraw);
    assert!(app.messages.is_empty());
    assert_eq!(app.draft, "/definitely-not-real");
    assert!(
        app.status
            .as_deref()
            .is_some_and(|status| status.contains("unknown desktop slash command"))
    );
}

#[test]
fn single_session_slash_copy_uses_latest_assistant_response_without_submitting() {
    let mut app = SingleSessionApp::new(None);
    app.messages
        .push(SingleSessionMessage::assistant("completed answer"));
    app.handle_key(KeyInput::Character("/copy".to_string()));

    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::CopyLatestResponse("completed answer".to_string())
    );
    assert!(app.draft.is_empty());
    assert_eq!(app.messages.len(), 1);

    app.handle_key(KeyInput::Character("/copy".to_string()));
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "streaming answer".to_string(),
    ));
    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::CopyLatestResponse("streaming answer".to_string())
    );
}

#[test]
fn single_session_slash_copy_reports_missing_response_locally() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("/copy".to_string()));

    assert_eq!(app.handle_key(KeyInput::SubmitDraft), KeyOutcome::Redraw);
    assert!(app.messages.is_empty());
    assert!(app.draft.is_empty());
    assert_eq!(app.status.as_deref(), Some("no assistant response to copy"));
}

#[test]
fn single_session_transcript_roles_render_without_stringly_labels() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::user("question"));
    app.messages.push(SingleSessionMessage::assistant("answer"));
    app.messages
        .push(SingleSessionMessage::tool("using tool bash"));
    app.messages
        .push(SingleSessionMessage::system("system note"));
    app.messages.push(SingleSessionMessage::meta("meta note"));

    let body = app.body_lines().join("\n");
    assert!(body.contains("1  question"));
    assert!(body.contains("answer"));
    assert!(body.contains("  using tool bash"));
    assert!(body.contains("  system note"));
    assert!(body.contains("  meta note"));
    assert!(!body.contains("user:"));
    assert!(!body.contains("assistant:"));
}

#[test]
fn single_session_assistant_markdown_is_prepared_for_desktop_rendering() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::assistant(
        "# Plan\n\n- first\n- second\n\nUse `cargo test`.\n\n```rust\nfn main() {}\n```",
    ));

    let body = app.body_lines().join("\n");
    assert!(body.contains("Plan"));
    assert!(body.contains("• first"));
    assert!(body.contains("• second"));
    assert!(body.contains("Use `cargo test`."));
    assert!(body.contains("  rust"));
    assert!(body.contains("  fn main() {}"));
    assert!(!body.contains("```"));
}

#[test]
fn single_session_markdown_renderer_handles_rich_commonmark_shapes() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::assistant(
        "## Results\n\n> quote line\n> continues\n\n1. first\n2. second\n\n[docs](https://example.com) and **bold** plus _em_.\n\n| name | value |\n| --- | --- |\n| alpha | 42 |\n\n---",
    ));

    let lines = app.body_styled_lines();
    let body = lines
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    assert!(body.contains("Results"));
    assert_eq!(
        style_for_text(&lines, "Results"),
        Some(SingleSessionLineStyle::AssistantHeading)
    );
    assert!(body.contains("│ quote line continues"));
    assert_eq!(
        style_for_text(&lines, "│ quote line continues"),
        Some(SingleSessionLineStyle::AssistantQuote)
    );
    assert!(body.contains("1. first"));
    assert!(body.contains("2. second"));
    assert!(body.contains("docs ↗ https://example.com and bold plus em."));
    assert_eq!(
        style_for_text(&lines, "docs ↗ https://example.com and bold plus em."),
        Some(SingleSessionLineStyle::AssistantLink)
    );
    assert!(body.contains("name  │ value"));
    assert!(body.contains("alpha │ 42"));
    assert!(body.contains("──────┼──────"));
    assert_eq!(
        style_for_text(&lines, "alpha │ 42"),
        Some(SingleSessionLineStyle::AssistantTable)
    );
    assert!(body.contains("────────────"));
}

#[test]
fn single_session_markdown_renderer_scopes_links_and_structures_lists() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::assistant(
        "This is\none paragraph with [docs](https://example.com).\n\nNext paragraph.\n\n- [x] shipped\n- [ ] polish\n  - nested",
    ));

    let lines = app.body_styled_lines();
    let body = lines
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    assert!(body.contains("This is one paragraph with docs ↗ https://example.com."));
    assert_eq!(
        style_for_text(
            &lines,
            "This is one paragraph with docs ↗ https://example.com."
        ),
        Some(SingleSessionLineStyle::AssistantLink)
    );
    assert_eq!(
        style_for_text(&lines, "Next paragraph."),
        Some(SingleSessionLineStyle::Assistant)
    );
    assert!(body.contains("✓ shipped"));
    assert!(body.contains("☐ polish"));
    assert!(body.contains("  ◦ nested"));
}

#[test]
fn single_session_streaming_markdown_renders_before_done() {
    let mut app = SingleSessionApp::new(None);
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "## Streaming\n\n- first\n- [x] shipped\n\n[docs]".to_string(),
    ));
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "(https://example.com)\n\n```rust\nfn main() {}".to_string(),
    ));

    let lines = app.body_styled_lines();
    let body = lines
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    assert!(body.contains("Streaming"));
    assert_eq!(
        style_for_text(&lines, "Streaming"),
        Some(SingleSessionLineStyle::AssistantHeading)
    );
    assert!(body.contains("• first"));
    assert!(body.contains("✓ shipped"));
    assert!(body.contains("docs ↗ https://example.com"));
    assert_eq!(
        style_for_text(&lines, "docs ↗ https://example.com"),
        Some(SingleSessionLineStyle::AssistantLink)
    );
    assert!(body.contains("  rust"));
    assert!(body.contains("  fn main() {}"));
    assert!(!body.contains("```"));

    app.apply_session_event(session_launch::DesktopSessionEvent::Done);
    let finished_body = app.body_lines().join("\n");
    assert!(finished_body.contains("Streaming"));
    assert!(finished_body.contains("• first"));
    assert!(finished_body.contains("✓ shipped"));
    assert!(finished_body.contains("docs ↗ https://example.com"));
    assert!(finished_body.contains("  fn main() {}"));
    assert!(!finished_body.contains("```"));
}

#[test]
fn single_session_markdown_structure_uses_distinct_colors_and_cards() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::assistant(
        "# Heading\n\n> quoted\n\n| a | b |\n| - | - |\n| c | d |",
    ));
    let mut font_system = FontSystem::new();

    let buffers = single_session_text_buffers(&app, PhysicalSize::new(1200, 760), &mut font_system);
    let body = &buffers[1];
    assert_eq!(
        first_glyph_color_for_text(body, "Heading"),
        Some(single_session_line_color(
            SingleSessionLineStyle::AssistantHeading
        ))
    );
    assert_eq!(
        first_glyph_color_for_text(body, "│ quoted"),
        Some(single_session_line_color(
            SingleSessionLineStyle::AssistantQuote
        ))
    );
    assert_eq!(
        first_glyph_color_for_text(body, "c │ d"),
        Some(single_session_line_color(
            SingleSessionLineStyle::AssistantTable
        ))
    );

    let vertices = build_single_session_vertices(&app, PhysicalSize::new(1200, 760), 0.0, 0);
    assert!(vertices_have_color(&vertices, QUOTE_CARD_BACKGROUND_COLOR));
    assert!(vertices_have_color(&vertices, TABLE_CARD_BACKGROUND_COLOR));
}

#[test]
fn single_session_header_only_uses_previous_message_title_for_static_preview() {
    let card = test_session_card("session_alpha", "previous user request", "active");
    let mut app = SingleSessionApp::new(Some(card));
    let size = PhysicalSize::new(1000, 720);

    assert!(app.should_show_session_title_header());
    assert_eq!(
        single_session_text_key(&app, size).title,
        "previous user request"
    );

    app.messages.push(SingleSessionMessage::user("live prompt"));
    app.messages
        .push(SingleSessionMessage::assistant("live answer"));

    assert!(!app.should_show_session_title_header());
    assert_eq!(single_session_text_key(&app, size).title, "");
}

#[test]
fn single_session_activity_indicator_appears_only_for_active_work() {
    let mut app = SingleSessionApp::new(None);
    assert!(!app.activity_indicator_active());
    assert!(!app.composer_status_line().starts_with("◴ "));

    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "streaming".to_string(),
    ));
    assert!(app.activity_indicator_active());
    assert!(app.composer_status_line().starts_with("receiving"));

    app.apply_session_event(session_launch::DesktopSessionEvent::Done);
    assert!(!app.activity_indicator_active());
    assert!(!app.composer_status_line().starts_with("◴ "));

    assert_eq!(
        app.handle_key(KeyInput::OpenModelPicker),
        KeyOutcome::LoadModelCatalog
    );
    assert!(app.activity_indicator_active());
}

#[test]
fn desktop_space_key_inserts_visible_prompt_space() {
    assert_eq!(
        to_key_input(&Key::Named(NamedKey::Space), ModifiersState::empty()),
        KeyInput::Character(" ".to_string())
    );

    let mut app = SingleSessionApp::new(None);
    assert_eq!(
        app.handle_key(KeyInput::Character("hello".to_string())),
        KeyOutcome::Redraw
    );
    assert_eq!(
        app.handle_key(KeyInput::Character(" ".to_string())),
        KeyOutcome::Redraw
    );
    assert_eq!(
        app.handle_key(KeyInput::Character("world".to_string())),
        KeyOutcome::Redraw
    );
    assert_eq!(app.composer_text(), "1› hello world");
    assert!(
        single_session_text_key(&app, PhysicalSize::new(420, 640))
            .draft
            .contains("hello world")
    );
}

#[test]
fn desktop_arrow_word_navigation_maps_common_modifiers() {
    assert_eq!(
        to_key_input(&Key::Named(NamedKey::ArrowLeft), ModifiersState::CONTROL),
        KeyInput::MoveCursorWordLeft
    );
    assert_eq!(
        to_key_input(&Key::Named(NamedKey::ArrowRight), ModifiersState::CONTROL),
        KeyInput::MoveCursorWordRight
    );
    assert_eq!(
        to_key_input(&Key::Named(NamedKey::ArrowLeft), ModifiersState::ALT),
        KeyInput::CycleReasoningEffort(-1)
    );
    assert_eq!(
        to_key_input(&Key::Named(NamedKey::ArrowRight), ModifiersState::ALT),
        KeyInput::CycleReasoningEffort(1)
    );
}

#[test]
fn desktop_maps_session_info_hotkey() {
    assert_eq!(
        to_key_input(
            &Key::Character("s".into()),
            ModifiersState::CONTROL | ModifiersState::SHIFT
        ),
        KeyInput::ToggleSessionInfo
    );
}

#[test]
fn desktop_maps_terminal_editing_shortcuts_from_tui() {
    assert_eq!(
        to_key_input(&Key::Character("b".into()), ModifiersState::CONTROL),
        KeyInput::MoveCursorWordLeft
    );
    assert_eq!(
        to_key_input(&Key::Character("f".into()), ModifiersState::CONTROL),
        KeyInput::MoveCursorWordRight
    );
    assert_eq!(
        to_key_input(&Key::Character("w".into()), ModifiersState::CONTROL),
        KeyInput::DeletePreviousWord
    );
    assert_eq!(
        to_key_input(&Key::Character("x".into()), ModifiersState::CONTROL),
        KeyInput::CutInputLine
    );
    assert_eq!(
        to_key_input(&Key::Named(NamedKey::Backspace), ModifiersState::ALT),
        KeyInput::DeletePreviousWord
    );
    assert_eq!(
        to_key_input(&Key::Named(NamedKey::ArrowUp), ModifiersState::CONTROL),
        KeyInput::RetrieveQueuedDraft
    );
    assert_eq!(
        to_key_input(&Key::Character("v".into()), ModifiersState::ALT),
        KeyInput::AttachClipboardImage
    );
    assert_eq!(
        to_key_input(&Key::Character("d".into()), ModifiersState::CONTROL),
        KeyInput::CancelGeneration
    );
}

#[test]
fn desktop_maps_text_scale_shortcuts() {
    assert_eq!(
        to_key_input(&Key::Character("-".into()), ModifiersState::CONTROL),
        KeyInput::AdjustTextScale(-1)
    );
    assert_eq!(
        to_key_input(&Key::Character("=".into()), ModifiersState::CONTROL),
        KeyInput::AdjustTextScale(1)
    );
    assert_eq!(
        to_key_input(&Key::Character("+".into()), ModifiersState::CONTROL),
        KeyInput::AdjustTextScale(1)
    );
    assert_eq!(
        to_key_input(&Key::Character("0".into()), ModifiersState::CONTROL),
        KeyInput::ResetTextScale
    );
}

#[test]
fn single_session_draft_selection_extracts_text_and_highlights_prompt_offset() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello\nworld".to_string()));

    app.begin_draft_selection(SelectionPoint { line: 0, column: 2 });
    app.update_draft_selection(SelectionPoint { line: 1, column: 3 });

    assert_eq!(
        app.draft_selection_segments(),
        vec![
            SelectionLineSegment {
                line: 0,
                start_column: app.composer_prompt().chars().count() + 2,
                end_column: app.composer_prompt().chars().count() + 5,
            },
            SelectionLineSegment {
                line: 1,
                start_column: 0,
                end_column: 3,
            },
        ]
    );

    let vertices = build_single_session_vertices(&app, PhysicalSize::new(900, 700), 0.0, 0);
    assert!(vertices_have_color(&vertices, SELECTION_HIGHLIGHT_COLOR));
    assert_eq!(app.selected_draft_text(), Some("llo\nwor".to_string()));
}

#[test]
fn single_session_paste_and_typing_replace_draft_selection() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello world".to_string()));
    app.begin_draft_selection(SelectionPoint { line: 0, column: 6 });
    app.update_draft_selection(SelectionPoint {
        line: 0,
        column: 11,
    });

    app.paste_text("there");

    assert_eq!(app.composer_text(), "1› hello there");
    assert_eq!(app.draft_cursor_line_col(), (0, 11));

    app.begin_draft_selection(SelectionPoint { line: 0, column: 6 });
    app.update_draft_selection(SelectionPoint {
        line: 0,
        column: 11,
    });
    assert_eq!(
        app.handle_key(KeyInput::Character("friend".to_string())),
        KeyOutcome::Redraw
    );

    assert_eq!(app.composer_text(), "1› hello friend");
    assert_eq!(app.draft_cursor_line_col(), (0, 12));
}

#[test]
fn single_session_delete_removes_draft_selection() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello world".to_string()));
    app.begin_draft_selection(SelectionPoint { line: 0, column: 5 });
    app.update_draft_selection(SelectionPoint {
        line: 0,
        column: 11,
    });

    assert_eq!(app.handle_key(KeyInput::Backspace), KeyOutcome::Redraw);

    assert_eq!(app.composer_text(), "1› hello");
    assert_eq!(app.draft_cursor_line_col(), (0, 5));
}

#[test]
fn single_session_cut_and_retrieve_queued_draft_match_tui_shortcuts() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("cut me".to_string()));
    assert_eq!(
        app.handle_key(KeyInput::CutInputLine),
        KeyOutcome::CutDraftToClipboard("cut me".to_string())
    );
    assert_eq!(app.composer_text(), "1› ");

    app.is_processing = true;
    app.handle_key(KeyInput::Character("queued".to_string()));
    assert_eq!(app.handle_key(KeyInput::QueueDraft), KeyOutcome::Redraw);
    assert_eq!(app.composer_text(), "1› ");
    assert_eq!(
        app.handle_key(KeyInput::RetrieveQueuedDraft),
        KeyOutcome::Redraw
    );
    assert_eq!(app.composer_text(), "1› queued");
}

#[test]
fn single_session_header_exposes_desktop_binary_and_version() {
    let mut app = SingleSessionApp::new(Some(test_session_card(
        "session_header",
        "session header",
        "active",
    )));
    app.apply_session_event(session_launch::DesktopSessionEvent::SessionStarted {
        session_id: "session_header".to_string(),
    });
    let key = single_session_text_key(&app, PhysicalSize::new(900, 700));
    let build_version = option_env!("JCODE_DESKTOP_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"));

    assert!(key.version.contains(build_version));
    assert!(
        key.version.contains("jcode-desktop") || key.version.contains("jcode_desktop"),
        "version label should include the running desktop binary path, got {:?}",
        key.version
    );
}

#[test]
fn fresh_single_session_startup_puts_greeting_in_welcome_hero() {
    let app = SingleSessionApp::new(None);
    let key = single_session_text_key(&app, PhysicalSize::new(900, 700));

    assert_eq!(key.title, "");
    assert_is_handwritten_welcome_phrase(&key.welcome_hero);
    assert_visual_text_contains(&key, &key.welcome_hero);
    assert!(key.body.is_empty());
    assert!(key.welcome_hint.is_empty());
}

#[test]
fn single_session_text_buffers_include_header_version_area() {
    let mut app = SingleSessionApp::new(None);
    app.apply_session_event(session_launch::DesktopSessionEvent::SessionStarted {
        session_id: "session_header_buffers".to_string(),
    });
    let size = PhysicalSize::new(900, 700);
    let mut font_system = FontSystem::new();
    let buffers = single_session_text_buffers(&app, size, &mut font_system);

    assert_eq!(buffers.len(), 7);
    assert_eq!(single_session_text_areas(&buffers, size).len(), 5);
}

#[test]
fn fresh_welcome_greeting_uses_handwritten_hero_chrome() {
    let app = SingleSessionApp::new(None);
    let key = single_session_text_key(&app, PhysicalSize::new(1000, 720));
    let vertices = build_single_session_vertices(&app, PhysicalSize::new(1000, 720), 0.0, 0);

    assert_is_handwritten_welcome_phrase(&key.welcome_hero);
    assert_visual_text_contains(&key, &key.welcome_hero);
    assert!(key.welcome_hint.is_empty());
    assert!(vertices_have_color(&vertices, WELCOME_HANDWRITING_COLOR));
}

#[test]
fn fresh_welcome_handwriting_reveals_over_time() {
    let app = SingleSessionApp::new(None);
    let size = PhysicalSize::new(1000, 720);
    let early = build_single_session_vertices(&app, size, 0.0, 0);
    let middle = build_single_session_vertices(&app, size, 0.0, 4);
    let done = build_single_session_vertices(&app, size, 0.0, 10);

    let early_ink = vertices_with_color_count(&early, WELCOME_HANDWRITING_COLOR);
    let middle_ink = vertices_with_color_count(&middle, WELCOME_HANDWRITING_COLOR);
    let done_ink = vertices_with_color_count(&done, WELCOME_HANDWRITING_COLOR);

    assert!(early_ink > 0, "first frame should show initial ink");
    assert!(
        early_ink < middle_ink,
        "handwritten ink should grow during reveal: early={early_ink}, middle={middle_ink}"
    );
    assert_eq!(
        done_ink, 0,
        "completed reveal should hand off to the clean font without overlapping stroke ink"
    );
    assert!(vertices_have_color(&middle, WELCOME_HANDWRITING_COLOR));
    assert!(!vertices_have_color(&done, WELCOME_HANDWRITING_COLOR));
}

#[test]
fn welcome_hero_reveal_progress_eases_to_full() {
    let start = welcome_hero_reveal_progress_for_elapsed(Duration::ZERO);
    let middle = welcome_hero_reveal_progress_for_elapsed(Duration::from_millis(675));
    let done = welcome_hero_reveal_progress_for_elapsed(Duration::from_millis(1350));

    assert!(start > 0.0 && start < middle);
    assert!(middle < done);
    assert_eq!(done, 1.0);
    assert!(welcome_hero_reveal_is_active(start));
    assert!(welcome_hero_reveal_is_active(middle));
    assert!(!welcome_hero_reveal_is_active(done));
}

#[test]
fn handwritten_welcome_phrase_set_has_stable_curated_variants() {
    assert_eq!(HANDWRITTEN_WELCOME_PHRASES.len(), 1);
    assert_eq!(handwritten_welcome_phrase(0), "Hello there");
    assert_eq!(
        handwritten_welcome_phrase(HANDWRITTEN_WELCOME_PHRASES.len()),
        handwritten_welcome_phrase(0)
    );
}

#[test]
fn single_session_status_text_stays_clean_while_native_spinner_animates() {
    let mut app = SingleSessionApp::new(None);
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "streaming".to_string(),
    ));

    let first = single_session_text_key_for_tick(&app, PhysicalSize::new(900, 700), 0).status;
    let second = single_session_text_key_for_tick(&app, PhysicalSize::new(900, 700), 1).status;
    assert!(first.starts_with("receiving"));
    assert_eq!(first, second);
    assert!(!first.contains('◴'));
    assert!(!first.contains('◷'));
}

#[test]
fn single_session_visual_state_smoke_covers_markdown_spinner_and_switcher() {
    let size = PhysicalSize::new(1200, 760);
    let mut markdown_app = SingleSessionApp::new(Some(test_session_card(
        "session_visual",
        "stale title should hide",
        "active",
    )));
    markdown_app
        .messages
        .push(SingleSessionMessage::user("render this"));
    markdown_app.messages.push(SingleSessionMessage::assistant(
        "# Heading\n\n> quoted\n\n[docs](https://example.com)\n\n| k | v |\n| - | - |\n| color | yes |",
    ));
    markdown_app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "streaming tail".to_string(),
    ));

    let markdown_key = single_session_text_key(&markdown_app, size);
    assert_eq!(markdown_key.title, "");
    assert!(markdown_key.status.starts_with("receiving"));
    assert_visual_text_contains(&markdown_key, "│ quoted");
    assert_visual_text_contains(&markdown_key, "docs ↗ https://example.com");
    assert_visual_text_contains(&markdown_key, "color │ yes");
    assert_visual_text_contains(&markdown_key, "streaming tail");

    let markdown_vertices = build_single_session_vertices(&markdown_app, size, 0.0, 0);
    assert!(vertices_have_color(
        &markdown_vertices,
        QUOTE_CARD_BACKGROUND_COLOR
    ));
    assert!(vertices_have_color(
        &markdown_vertices,
        TABLE_CARD_BACKGROUND_COLOR
    ));

    let mut switcher_app = SingleSessionApp::new(None);
    assert_eq!(
        switcher_app.handle_key(KeyInput::OpenSessionSwitcher),
        KeyOutcome::LoadSessionSwitcher
    );
    let switcher_key = single_session_text_key(&switcher_app, size);
    assert_eq!(switcher_key.title, "");
    assert!(switcher_key.status.starts_with("loading recent sessions"));
    assert_visual_text_contains(&switcher_key, "desktop session switcher");
    assert_visual_text_contains(
        &switcher_key,
        "loading recent sessions from ~/.jcode/sessions...",
    );
}

#[test]
fn single_session_body_styled_lines_follow_roles_and_overlays() {
    let mut app = SingleSessionApp::new(None);
    app.messages
        .push(SingleSessionMessage::user("question\nmore context"));
    app.messages.push(SingleSessionMessage::assistant(
        "answer\n\n```rust\nfn main() {}\n```",
    ));
    app.messages.push(SingleSessionMessage::tool("bash done"));
    app.messages
        .push(SingleSessionMessage::meta("model switched"));

    let lines = app.body_styled_lines();
    let segments = single_session_styled_text_segments(&lines);
    assert!(
        segments.contains(&(
            "1",
            Attrs::new()
                .family(Family::Name(SINGLE_SESSION_FONT_FAMILY))
                .color(user_prompt_number_color(2))
        ))
    );
    assert!(
        segments.contains(&(
            "› ",
            Attrs::new()
                .family(Family::Name(SINGLE_SESSION_FONT_FAMILY))
                .color(text_color(USER_PROMPT_ACCENT_COLOR))
        ))
    );
    assert!(
        segments.contains(&(
            "question",
            Attrs::new()
                .family(Family::Name(SINGLE_SESSION_FONT_FAMILY))
                .color(single_session_line_color(SingleSessionLineStyle::User))
        ))
    );
    assert!(
        segments.contains(&(
            "answer",
            Attrs::new()
                .family(Family::Name(SINGLE_SESSION_ASSISTANT_FONT_FAMILY))
                .color(single_session_line_color(SingleSessionLineStyle::Assistant))
        ))
    );

    assert_eq!(
        style_for_text(&lines, "1  question"),
        Some(SingleSessionLineStyle::User)
    );
    assert_eq!(
        style_for_text(&lines, "   more context"),
        Some(SingleSessionLineStyle::UserContinuation)
    );
    assert_eq!(
        style_for_text(&lines, "answer"),
        Some(SingleSessionLineStyle::Assistant)
    );
    assert_eq!(
        style_for_text(&lines, "  rust"),
        Some(SingleSessionLineStyle::Code)
    );
    assert_eq!(
        style_for_text(&lines, "  fn main() {}"),
        Some(SingleSessionLineStyle::Code)
    );
    assert_eq!(
        style_for_text(&lines, "  bash done"),
        Some(SingleSessionLineStyle::Tool)
    );
    assert_eq!(
        style_for_text(&lines, "  model switched"),
        Some(SingleSessionLineStyle::Meta)
    );

    app.handle_key(KeyInput::HotkeyHelp);
    let help = app.inline_widget_styled_lines();
    assert_eq!(
        style_for_text(&help, "desktop shortcuts"),
        Some(SingleSessionLineStyle::OverlayTitle)
    );
    assert_eq!(
        style_for_text(
            &help,
            "  Ctrl+V      paste clipboard image when no text is present"
        ),
        Some(SingleSessionLineStyle::Overlay)
    );
}

#[test]
fn assistant_symbol_lines_use_main_font_to_avoid_missing_glyph_boxes() {
    let symbol_line = "docs ↗ https://example.com";
    let symbol_lines = [SingleSessionStyledLine {
        text: symbol_line.to_string(),
        style: SingleSessionLineStyle::AssistantLink,
    }];
    let symbol_segments = single_session_styled_text_segments(&symbol_lines);
    assert!(
        symbol_segments.contains(&(
            symbol_line,
            Attrs::new()
                .family(Family::Name(SINGLE_SESSION_FONT_FAMILY))
                .color(single_session_line_color(
                    SingleSessionLineStyle::AssistantLink
                ))
        ))
    );

    let plain_line = "plain assistant prose";
    let plain_lines = [SingleSessionStyledLine {
        text: plain_line.to_string(),
        style: SingleSessionLineStyle::Assistant,
    }];
    let plain_segments = single_session_styled_text_segments(&plain_lines);
    assert!(
        plain_segments.contains(&(
            plain_line,
            Attrs::new()
                .family(Family::Name(SINGLE_SESSION_ASSISTANT_FONT_FAMILY))
                .color(single_session_line_color(SingleSessionLineStyle::Assistant))
        ))
    );
}

#[test]
fn glyphon_body_buffer_uses_line_style_colors() {
    let mut app = SingleSessionApp::new(Some(test_session_card(
        "session_colors",
        "colors",
        "active",
    )));
    app.messages.push(SingleSessionMessage::user("question"));
    app.messages.push(SingleSessionMessage::assistant(
        "answer\n\n```rust\nfn main() {}\n```",
    ));
    app.messages.push(SingleSessionMessage::tool("bash done"));
    app.messages
        .push(SingleSessionMessage::meta("model switched"));
    let mut font_system = FontSystem::new();

    let buffers = single_session_text_buffers(&app, PhysicalSize::new(1200, 760), &mut font_system);
    let body = &buffers[1];

    assert_eq!(
        first_glyph_color_for_text(body, "answer"),
        Some(single_session_line_color(SingleSessionLineStyle::Assistant))
    );
    assert_eq!(
        first_glyph_color_for_text(body, "  rust"),
        Some(single_session_line_color(SingleSessionLineStyle::Code))
    );
    assert_eq!(
        first_glyph_color_for_text(body, "  bash done"),
        Some(single_session_line_color(SingleSessionLineStyle::Tool))
    );
    assert_eq!(
        first_glyph_color_for_text(body, "  model switched"),
        Some(single_session_line_color(SingleSessionLineStyle::Meta))
    );
}

#[test]
fn single_session_transcript_card_runs_group_card_styles() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::assistant(
        "answer\n\n```rust\nfn main() {}\n```",
    ));
    app.messages.push(SingleSessionMessage::tool("bash done"));
    app.error = Some("boom".to_string());

    let lines = app.body_styled_lines();
    let runs = single_session_transcript_card_runs(&lines);

    let code = runs
        .iter()
        .find(|run| run.style == SingleSessionLineStyle::Code)
        .expect("code block should have a card run");
    assert_eq!(code.line_count, 2);
    assert_eq!(lines[code.line].text, "  rust");

    // Tool rows are neutral inline transcript rows, not orange card runs.
    assert!(
        runs.iter()
            .all(|run| run.style != SingleSessionLineStyle::Tool)
    );
    assert!(lines.iter().any(|line| line.text == "  bash done"));

    let error = runs
        .iter()
        .find(|run| run.style == SingleSessionLineStyle::Error)
        .expect("error line should have a card run");
    assert_eq!(error.line_count, 1);
    assert_eq!(lines[error.line].text, "error: boom");
}

#[test]
fn single_session_vertices_include_transcript_card_backgrounds() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::assistant(
        "answer\n\n```rust\nfn main() {}\n```",
    ));
    app.messages.push(SingleSessionMessage::tool("bash done"));
    app.error = Some("boom".to_string());

    let vertices = build_single_session_vertices(&app, PhysicalSize::new(1000, 720), 0.0, 0);

    assert!(vertices_have_color(&vertices, CODE_BLOCK_BACKGROUND_COLOR));
    assert!(vertices_have_color(&vertices, ERROR_CARD_BACKGROUND_COLOR));
}

fn vertices_have_color(vertices: &[Vertex], color: [f32; 4]) -> bool {
    vertices.iter().any(|vertex| vertex.color == color)
}

fn vertices_with_color_count(vertices: &[Vertex], color: [f32; 4]) -> usize {
    vertices
        .iter()
        .filter(|vertex| vertex.color == color)
        .count()
}

fn positions_for_color(vertices: &[Vertex], color: [f32; 4]) -> Vec<[u32; 2]> {
    vertices
        .iter()
        .filter(|vertex| vertex.color == color)
        .map(|vertex| vertex.position.map(f32::to_bits))
        .collect()
}

fn assert_visual_text_contains(key: &SingleSessionTextKey, expected: &str) {
    let body_lines = key
        .body
        .iter()
        .map(|line| line.text.as_str())
        .chain(std::iter::once(key.welcome_hero.as_str()))
        .chain(key.welcome_hint.iter().map(|line| line.text.as_str()))
        .collect::<Vec<_>>();
    let body = body_lines.join("\n");
    assert!(
        body.contains(expected),
        "expected visual body to contain {expected:?}, got:\n{body}"
    );
}

fn assert_is_handwritten_welcome_phrase(phrase: &str) {
    assert!(
        HANDWRITTEN_WELCOME_PHRASES.contains(&phrase),
        "unexpected handwritten welcome phrase: {phrase:?}"
    );
}

fn test_session_card(id: &str, title: &str, status: &str) -> workspace::SessionCard {
    workspace::SessionCard {
        session_id: id.to_string(),
        title: title.to_string(),
        subtitle: format!("{status} · test-model"),
        detail: format!("2 msgs · {title}-workspace"),
        preview_lines: vec![format!("user {title} prompt")],
        detail_lines: vec![format!("assistant {title} response")],
    }
}

fn style_for_text(lines: &[SingleSessionStyledLine], text: &str) -> Option<SingleSessionLineStyle> {
    lines
        .iter()
        .find(|line| line.text == text)
        .map(|line| line.style)
}

fn first_glyph_color_for_text(buffer: &Buffer, text: &str) -> Option<TextColor> {
    buffer
        .layout_runs()
        .find(|run| run.text == text)
        .and_then(|run| run.glyphs.first().and_then(|glyph| glyph.color_opt))
}

#[test]
fn single_session_tool_events_expand_context_and_collapse_previous_call() {
    let mut app = SingleSessionApp::new(None);
    app.apply_session_event(session_launch::DesktopSessionEvent::ToolStarted {
        name: "bash".to_string(),
    });
    app.apply_session_event(session_launch::DesktopSessionEvent::ToolInput {
        delta: r#"{"command":"cargo test -p jcode-desktop","timeout":120000,"intent":"Run desktop tests"}"#.to_string(),
    });
    app.apply_session_event(session_launch::DesktopSessionEvent::ToolExecuting {
        name: "bash".to_string(),
    });
    app.apply_session_event(session_launch::DesktopSessionEvent::ToolFinished {
        name: "bash".to_string(),
        summary: "tests passed".to_string(),
        is_error: false,
    });

    let body = app.body_lines().join("\n");
    assert!(body.contains("  ✓ bash · done · tests passed"));
    assert!(body.contains("intent: Run desktop tests"));
    assert!(body.contains("$ cargo test -p jcode-desktop"));
    assert!(!body.contains("    timeout: 120000"));
    assert_eq!(app.status.as_deref(), Some("tool bash done"));

    app.apply_session_event(session_launch::DesktopSessionEvent::ToolStarted {
        name: "read".to_string(),
    });
    let body = app.body_lines().join("\n");
    assert!(body.contains("  ✓ bash · done · tests passed"));
    assert!(!body.contains("Run desktop tests"));
    assert!(body.contains("  ○ read · preparing"));
}

#[test]
fn single_session_adjacent_tool_messages_render_as_compact_summary() {
    let mut app = SingleSessionApp::new(None);
    app.messages
        .push(SingleSessionMessage::tool("▸ read done: 100 chars"));
    app.messages
        .push(SingleSessionMessage::tool("▸ agentgrep done: 10 matches"));
    app.messages
        .push(SingleSessionMessage::tool("▸ agentgrep done: 11 matches"));
    app.messages.push(SingleSessionMessage::tool("▸ edit done"));

    let body = app.body_lines();
    assert_eq!(body.len(), 1);
    assert_eq!(
        body[0],
        "  ▸ tools: 1 read, 2 agentgrep, 1 edit · ~23 tokens"
    );
}

#[test]
fn single_session_tool_summary_resets_at_non_tool_messages() {
    let mut app = SingleSessionApp::new(None);
    app.messages
        .push(SingleSessionMessage::tool("▸ read done: 100 chars"));
    app.messages.push(SingleSessionMessage::assistant("ok"));
    app.messages.push(SingleSessionMessage::tool("▸ edit done"));

    let body = app.body_lines().join("\n");
    assert!(body.contains("  ✓ read · done · 100 chars"));
    assert!(body.contains("ok"));
    assert!(body.contains("  ✓ edit · done"));
    assert!(!body.contains("tools:"));
}

#[test]
fn single_session_hotkey_help_toggles_discoverable_shortcuts() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::user("question"));

    assert_eq!(app.handle_key(KeyInput::HotkeyHelp), KeyOutcome::Redraw);
    assert!(app.show_help);
    let help = app
        .inline_widget_styled_lines()
        .into_iter()
        .map(|line| line.text)
        .collect::<Vec<_>>();
    assert!(help.iter().any(|line| line == "desktop shortcuts"));
    assert!(help_has_shortcut(
        &help,
        "Ctrl+Enter",
        "queue while running, send when idle"
    ));
    assert!(help_has_shortcut(
        &help,
        "Ctrl+Shift+C",
        "copy latest assistant response"
    ));
    assert!(help_has_shortcut(
        &help,
        "Ctrl+P/O",
        "open recent session switcher"
    ));
    assert!(help_has_shortcut(
        &help,
        "Alt+Up/Down",
        "jump between user prompts"
    ));
    let help_text = help.join("\n");
    assert!(!help_text.contains("desktop queue follow-up pending"));
    assert!(!help_text.contains("1  question"));
    assert!(app.body_lines().join("\n").contains("1  question"));

    assert_eq!(app.handle_key(KeyInput::Escape), KeyOutcome::Redraw);
    assert!(!app.show_help);
    assert!(app.inline_widget_styled_lines().is_empty());
    assert_eq!(app.handle_key(KeyInput::Escape), KeyOutcome::None);
    assert!(app.body_lines().join("\n").contains("1  question"));
}

#[test]
fn single_session_escape_soft_interrupts_running_generation() {
    let mut app = SingleSessionApp::new(None);
    assert_eq!(app.handle_key(KeyInput::Escape), KeyOutcome::None);

    app.is_processing = true;
    assert_eq!(
        app.handle_key(KeyInput::Escape),
        KeyOutcome::CancelGeneration
    );
}

fn help_has_shortcut(lines: &[String], shortcut: &str, description: &str) -> bool {
    lines
        .iter()
        .any(|line| line.contains(shortcut) && line.contains(description))
}

#[test]
fn single_session_model_cycle_updates_status_and_transcript() {
    let mut app = SingleSessionApp::new(None);

    assert_eq!(
        app.handle_key(KeyInput::CycleModel(1)),
        KeyOutcome::CycleModel(1)
    );
    app.apply_session_event(session_launch::DesktopSessionEvent::ModelChanged {
        model: "claude-opus-4-5".to_string(),
        provider_name: Some("Claude".to_string()),
        error: None,
    });

    assert_eq!(
        app.status.as_deref(),
        Some("model: Claude · claude-opus-4-5")
    );
    assert!(
        app.body_lines()
            .join("\n")
            .contains("model switched to Claude · claude-opus-4-5")
    );
}

#[test]
fn single_session_model_picker_loads_filters_and_selects_model() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::assistant(
        "existing transcript stays visible",
    ));

    assert_eq!(
        app.handle_key(KeyInput::OpenModelPicker),
        KeyOutcome::LoadModelCatalog
    );
    assert!(app.model_picker.open);
    assert!(app.model_picker.loading);
    assert!(
        app.inline_widget_styled_lines()
            .into_iter()
            .any(|line| line.text.contains("loading models"))
    );

    app.apply_session_event(session_launch::DesktopSessionEvent::ModelCatalog {
        current_model: Some("claude-sonnet-4-5".to_string()),
        provider_name: Some("Claude".to_string()),
        models: vec![
            session_launch::DesktopModelChoice {
                model: "claude-sonnet-4-5".to_string(),
                provider: Some("claude".to_string()),
                api_method: Some("oauth".to_string()),
                detail: Some("active account".to_string()),
                available: true,
            },
            session_launch::DesktopModelChoice {
                model: "claude-opus-4-5".to_string(),
                provider: Some("claude".to_string()),
                api_method: Some("oauth".to_string()),
                detail: Some("premium".to_string()),
                available: true,
            },
        ],
    });

    let body = app.body_lines().join("\n");
    assert!(body.contains("existing transcript stays visible"));
    assert!(!body.contains("MODEL"));
    let picker = app
        .inline_widget_styled_lines()
        .into_iter()
        .map(|line| line.text)
        .collect::<Vec<_>>()
        .join("\n");
    assert!(picker.contains("╭─ model picker · current Claude · claude-sonnet-4-5"));
    assert!(picker.contains("MODEL"));
    assert!(picker.contains("PROVIDER"));
    assert!(picker.contains("METHOD"));
    assert!(picker.contains("✓ claude-sonnet-4-5"));
    assert!(picker.contains("claude"));
    assert!(picker.contains("oauth"));

    assert_eq!(
        app.handle_key(KeyInput::Character("opus".to_string())),
        KeyOutcome::Redraw
    );
    let filtered = app
        .inline_widget_styled_lines()
        .into_iter()
        .map(|line| line.text)
        .collect::<Vec<_>>()
        .join("\n");
    assert!(filtered.contains("\"opus\""));
    assert!(filtered.contains("claude-opus-4-5"));

    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::SetModel("claude-opus-4-5".to_string())
    );
    assert!(!app.model_picker.open);
}

#[test]
fn single_session_session_switcher_loads_filters_and_resumes_session() {
    let mut app = SingleSessionApp::new(None);
    app.messages
        .push(SingleSessionMessage::user("stale live transcript"));
    app.handle_key(KeyInput::Character("pending draft".to_string()));

    assert_eq!(
        app.handle_key(KeyInput::OpenSessionSwitcher),
        KeyOutcome::LoadSessionSwitcher
    );
    assert!(app.session_switcher.open);
    assert!(app.session_switcher.loading);
    assert!(
        app.body_lines()
            .join("\n")
            .contains("loading recent sessions")
    );

    app.apply_session_switcher_cards(vec![
        test_session_card("session_alpha", "alpha", "alpha status"),
        test_session_card("session_beta", "beta", "beta status"),
    ]);
    let switcher = app.body_lines().join("\n");
    assert!(switcher.contains("desktop session switcher"));
    assert!(switcher.contains("alpha"));
    assert!(switcher.contains("beta"));

    assert_eq!(
        app.handle_key(KeyInput::Character("beta".to_string())),
        KeyOutcome::Redraw
    );
    assert!(app.body_lines().join("\n").contains("filter: beta"));

    assert_eq!(app.handle_key(KeyInput::SubmitDraft), KeyOutcome::Redraw);
    assert!(!app.session_switcher.open);
    assert_eq!(
        app.session
            .as_ref()
            .map(|session| session.session_id.as_str()),
        Some("session_beta")
    );
    assert_eq!(app.live_session_id.as_deref(), Some("session_beta"));
    assert_eq!(app.draft, "pending draft");
    assert_eq!(app.status.as_deref(), Some("resumed beta"));

    let resumed = app.body_lines().join("\n");
    assert!(resumed.contains("beta status"));
    assert!(!resumed.contains("stale live transcript"));
}

#[test]
fn desktop_resume_args_are_parsed() {
    assert_eq!(
        desktop_resume_session_id_from_args(["jcode-desktop", "--resume", "session_beta"]),
        Some("session_beta".to_string())
    );
    assert_eq!(
        desktop_resume_session_id_from_args(["jcode-desktop", "--resume=session_gamma"]),
        Some("session_gamma".to_string())
    );
    assert_eq!(desktop_resume_session_id_from_args(["jcode-desktop"]), None);
}

#[test]
fn initial_single_session_app_marks_resume_visible_before_interaction() {
    let DesktopApp::SingleSession(app) = initial_single_session_app(Some("session_missing")) else {
        panic!("expected single session app");
    };

    assert_eq!(app.live_session_id.as_deref(), Some("session_missing"));
    assert!(
        !app.body_lines()
            .join("\n")
            .contains("What are we building today")
    );
    assert!(app.body_lines().join("\n").contains("resumed session"));
}

#[test]
fn single_session_session_switcher_marks_current_session_and_reloads() {
    let alpha = test_session_card("session_alpha", "alpha", "active");
    let beta = test_session_card("session_beta", "beta", "idle");
    let mut app = SingleSessionApp::new(Some(alpha.clone()));

    assert_eq!(
        app.handle_key(KeyInput::OpenSessionSwitcher),
        KeyOutcome::LoadSessionSwitcher
    );
    app.apply_session_switcher_cards(vec![beta, alpha]);

    assert_eq!(app.session_switcher.selected, 1);
    assert!(app.body_lines().join("\n").contains("› ✓ alpha"));

    assert_eq!(
        app.handle_key(KeyInput::RefreshSessions),
        KeyOutcome::LoadSessionSwitcher
    );
    assert!(app.session_switcher.loading);
    assert_eq!(app.status.as_deref(), Some("loading recent sessions"));
}

#[test]
fn single_session_model_picker_updates_current_model_after_switch() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::OpenModelPicker);

    app.apply_session_event(session_launch::DesktopSessionEvent::ModelChanged {
        model: "gpt-5.4".to_string(),
        provider_name: Some("OpenAI".to_string()),
        error: None,
    });

    assert_eq!(app.model_picker.current_model.as_deref(), Some("gpt-5.4"));
    assert_eq!(app.model_picker.provider_name.as_deref(), Some("OpenAI"));
    assert!(
        app.inline_widget_styled_lines()
            .into_iter()
            .map(|line| line.text)
            .collect::<Vec<_>>()
            .join("\n")
            .contains("╭─ model picker · current OpenAI · gpt-5.4")
    );
    assert!(app.composer_status_line().contains("model OpenAI/gpt-5.4"));
}

#[test]
fn single_session_stdin_request_is_visible_in_transcript() {
    let mut app = SingleSessionApp::new(None);

    app.apply_session_event(session_launch::DesktopSessionEvent::StdinRequest {
        request_id: "stdin-1".to_string(),
        prompt: "Password:".to_string(),
        is_password: true,
        tool_call_id: "tool-1".to_string(),
    });

    assert_eq!(app.status.as_deref(), Some("interactive input requested"));
    let body = app.body_lines().join("\n");
    assert!(body.contains("interactive password input requested"));
    assert!(body.contains("prompt: Password:"));
    assert!(body.contains("request: stdin-1"));
    assert!(body.contains("tool: tool-1"));
}

#[test]
fn single_session_stdin_response_masks_password_and_sends_input() {
    let mut app = SingleSessionApp::new(None);
    app.apply_session_event(session_launch::DesktopSessionEvent::StdinRequest {
        request_id: "stdin-1".to_string(),
        prompt: "Password:".to_string(),
        is_password: true,
        tool_call_id: "tool-1".to_string(),
    });

    assert_eq!(
        app.handle_key(KeyInput::Character("s3 cr".to_string())),
        KeyOutcome::Redraw
    );
    app.paste_text("et");
    let body = app.body_lines().join("\n");
    assert!(body.contains("input: •••••••"));
    assert!(!body.contains("s3 cr"));

    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::SendStdinResponse {
            request_id: "stdin-1".to_string(),
            input: "s3 cret".to_string()
        }
    );
    assert!(app.stdin_response.is_none());
    assert_eq!(app.status.as_deref(), Some("sending interactive input"));
}

#[test]
fn single_session_attached_image_is_sent_with_next_prompt() {
    let mut app = SingleSessionApp::new(None);
    app.attach_image("image/png".to_string(), "abc123".to_string());

    assert!(app.composer_status_line().contains("1 image"));
    app.handle_key(KeyInput::Character("describe this".to_string()));

    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::StartFreshSession {
            message: "describe this".to_string(),
            images: vec![("image/png".to_string(), "abc123".to_string())]
        }
    );
    assert!(app.pending_images.is_empty());
}

#[test]
fn single_session_clear_attached_images_shortcut_clears_pending_images() {
    let mut app = SingleSessionApp::new(None);
    app.attach_image("image/png".to_string(), "abc123".to_string());

    assert_eq!(
        app.handle_key(KeyInput::ClearAttachedImages),
        KeyOutcome::Redraw
    );
    assert!(app.pending_images.is_empty());
    assert_eq!(app.status.as_deref(), Some("cleared image attachments"));
    assert_eq!(
        app.handle_key(KeyInput::ClearAttachedImages),
        KeyOutcome::None
    );
}

#[test]
fn clipboard_image_paste_is_disabled_while_answering_stdin() {
    let mut app = SingleSessionApp::new(None);
    assert!(app.accepts_clipboard_image_paste());

    app.apply_session_event(session_launch::DesktopSessionEvent::StdinRequest {
        request_id: "stdin-1".to_string(),
        prompt: "Password:".to_string(),
        is_password: true,
        tool_call_id: "tool-1".to_string(),
    });

    assert!(!app.accepts_clipboard_image_paste());
}

#[test]
fn single_session_ctrl_enter_queues_while_processing_then_dequeues() {
    let mut app = SingleSessionApp::new(None);
    app.is_processing = true;
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "working".to_string(),
    ));
    app.handle_key(KeyInput::Character("next prompt".to_string()));

    assert_eq!(app.handle_key(KeyInput::QueueDraft), KeyOutcome::Redraw);
    assert!(app.composer_status_line().contains("1 queued"));
    assert!(app.draft.is_empty());

    app.apply_session_event(session_launch::DesktopSessionEvent::Done);
    assert_eq!(
        app.take_next_queued_draft(),
        Some(("next prompt".to_string(), Vec::new()))
    );
    assert!(app.is_processing);
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum QueueTraceAction {
    TypeA,
    TypeB,
    CtrlEnter,
    Reloading,
    Reloaded,
    SessionStarted,
    TextDelta,
    Done,
    Error,
    TryDrainQueued,
}

#[derive(Default, Debug)]
struct QueueReferenceModel {
    draft: String,
    processing: bool,
    reloading: bool,
    error: bool,
    queued: Vec<String>,
    sent: Vec<String>,
}

impl QueueReferenceModel {
    fn apply(&mut self, action: QueueTraceAction) -> Option<String> {
        match action {
            QueueTraceAction::TypeA => self.draft.push('a'),
            QueueTraceAction::TypeB => self.draft.push('b'),
            QueueTraceAction::CtrlEnter => {
                let message = self.draft.trim().to_string();
                if message.is_empty() {
                    return None;
                }
                self.draft.clear();
                if self.processing {
                    self.queued.push(message);
                } else {
                    self.processing = true;
                    self.error = false;
                    self.sent.push(message.clone());
                    return Some(message);
                }
            }
            QueueTraceAction::Reloading => {
                // A hot reload is not a turn end. Wait-til-turn-end prompts must stay queued.
                self.processing = true;
                self.reloading = true;
            }
            QueueTraceAction::Reloaded => {
                self.processing = true;
                self.reloading = false;
            }
            QueueTraceAction::SessionStarted => {
                // Reconnection/session-start is also not a turn end.
            }
            QueueTraceAction::TextDelta => self.reloading = false,
            QueueTraceAction::Done => {
                if self.reloading {
                    // A terminal event racing with reload is stale unless the reconnected turn has
                    // produced activity again.
                    self.processing = true;
                } else {
                    self.processing = false;
                }
            }
            QueueTraceAction::Error => {
                self.processing = false;
                self.reloading = false;
                self.error = true;
            }
            QueueTraceAction::TryDrainQueued => {
                if !self.processing && !self.error && !self.queued.is_empty() {
                    let message = self.queued.remove(0);
                    self.processing = true;
                    self.error = false;
                    self.sent.push(message.clone());
                    return Some(message);
                }
            }
        }
        None
    }
}

fn apply_queue_trace_action_to_app(
    app: &mut SingleSessionApp,
    action: QueueTraceAction,
) -> Option<String> {
    match action {
        QueueTraceAction::TypeA => {
            app.handle_key(KeyInput::Character("a".to_string()));
            None
        }
        QueueTraceAction::TypeB => {
            app.handle_key(KeyInput::Character("b".to_string()));
            None
        }
        QueueTraceAction::CtrlEnter => match app.handle_key(KeyInput::QueueDraft) {
            KeyOutcome::StartFreshSession { message, .. }
            | KeyOutcome::SendDraft { message, .. } => Some(message),
            KeyOutcome::Redraw | KeyOutcome::None => None,
            other => panic!("unexpected Ctrl+Enter outcome in queue trace: {other:?}"),
        },
        QueueTraceAction::Reloading => {
            app.apply_session_event(session_launch::DesktopSessionEvent::Reloading {
                new_socket: Some("/tmp/jcode-reload-model-test.sock".to_string()),
            });
            None
        }
        QueueTraceAction::Reloaded => {
            app.apply_session_event(session_launch::DesktopSessionEvent::Reloaded {
                session_id: "reload-model-session".to_string(),
            });
            None
        }
        QueueTraceAction::SessionStarted => {
            app.apply_session_event(session_launch::DesktopSessionEvent::SessionStarted {
                session_id: "reload-model-session".to_string(),
            });
            None
        }
        QueueTraceAction::TextDelta => {
            app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
                "post reload activity".to_string(),
            ));
            None
        }
        QueueTraceAction::Done => {
            app.apply_session_event(session_launch::DesktopSessionEvent::Done);
            None
        }
        QueueTraceAction::Error => {
            app.apply_session_event(session_launch::DesktopSessionEvent::Error(
                "reload failed".to_string(),
            ));
            None
        }
        QueueTraceAction::TryDrainQueued => app
            .take_next_queued_draft()
            .map(|(message, _images)| message),
    }
}

fn assert_queue_trace_state(
    app: &SingleSessionApp,
    model: &QueueReferenceModel,
    real_sent: &[String],
    trace: &[QueueTraceAction],
) {
    assert_eq!(app.draft, model.draft, "draft mismatch for trace {trace:?}");
    assert_eq!(
        app.is_processing, model.processing,
        "processing mismatch for trace {trace:?}"
    );
    assert_eq!(
        app.queued_draft_count(),
        model.queued.len(),
        "queued draft count mismatch for trace {trace:?}"
    );
    assert_eq!(
        app.queued_draft_messages(),
        model.queued,
        "queued draft mismatch for trace {trace:?}"
    );
    assert_eq!(real_sent, model.sent, "sent mismatch for trace {trace:?}");
    assert_eq!(
        app.error.is_some(),
        model.error,
        "error mismatch for trace {trace:?}"
    );

    let status = app.composer_status_line();
    if model.queued.is_empty() {
        assert!(
            !status.contains(" queued"),
            "status should not show queued count for trace {trace:?}: {status}"
        );
    } else {
        assert!(
            status.contains(&format!("{} queued", model.queued.len())),
            "status should show queued count for trace {trace:?}: {status}"
        );
    }

    let body = app.body_lines().join("\n");
    for queued in &model.queued {
        assert!(
            body.contains(&format!("queued prompt: {queued}")),
            "body should show queued prompt {queued:?} for trace {trace:?}: {body}"
        );
    }
}

fn run_queue_trace(trace: &[QueueTraceAction]) {
    let mut app = SingleSessionApp::new(None);
    let mut model = QueueReferenceModel::default();
    let mut real_sent = Vec::new();
    let mut prefix = Vec::new();

    for &action in trace {
        prefix.push(action);
        let expected_send = model.apply(action);
        let actual_send = apply_queue_trace_action_to_app(&mut app, action);
        assert_eq!(
            actual_send, expected_send,
            "send outcome mismatch after trace prefix {prefix:?}"
        );
        if let Some(message) = actual_send {
            real_sent.push(message);
        }
        if action == QueueTraceAction::Reloading {
            assert!(
                app.composer_status_line()
                    .contains("server reloading, reconnecting"),
                "reload step should be visible in status for trace {prefix:?}: {}",
                app.composer_status_line()
            );
        }
        assert_queue_trace_state(&app, &model, &real_sent, &prefix);
    }
}

fn apply_session_event_batch_then_auto_drain(
    app: &mut DesktopApp,
    events: Vec<session_launch::DesktopSessionEvent>,
) -> Option<String> {
    let stats = apply_desktop_session_event_batch_with_stats(app, events);
    if !stats.visible_changed {
        return None;
    }
    app.take_next_queued_single_session_draft()
        .map(|(message, _images)| message)
}

#[test]
fn single_session_event_loop_auto_drain_ignores_stale_done_after_reload() {
    let mut desktop = DesktopApp::SingleSession(SingleSessionApp::new(None));
    let DesktopApp::SingleSession(app) = &mut desktop else {
        unreachable!();
    };
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "working".to_string(),
    ));
    app.is_processing = true;
    app.handle_key(KeyInput::Character("next".to_string()));
    assert_eq!(app.handle_key(KeyInput::QueueDraft), KeyOutcome::Redraw);

    let drained = apply_session_event_batch_then_auto_drain(
        &mut desktop,
        vec![
            session_launch::DesktopSessionEvent::Reloading {
                new_socket: Some("/tmp/jcode-reload-event-loop-test.sock".to_string()),
            },
            session_launch::DesktopSessionEvent::Done,
        ],
    );

    assert_eq!(
        drained, None,
        "stale Done after reload must not auto-drain queued prompt"
    );
    let DesktopApp::SingleSession(app) = &desktop else {
        unreachable!();
    };
    assert_eq!(app.queued_draft_messages(), vec!["next".to_string()]);
    assert!(app.composer_status_line().contains("1 queued"));
    assert!(app.is_processing);
}

#[test]
fn single_session_event_loop_auto_drain_after_post_reload_activity_done() {
    let mut desktop = DesktopApp::SingleSession(SingleSessionApp::new(None));
    let DesktopApp::SingleSession(app) = &mut desktop else {
        unreachable!();
    };
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "working".to_string(),
    ));
    app.is_processing = true;
    app.handle_key(KeyInput::Character("next".to_string()));
    assert_eq!(app.handle_key(KeyInput::QueueDraft), KeyOutcome::Redraw);

    let drained = apply_session_event_batch_then_auto_drain(
        &mut desktop,
        vec![
            session_launch::DesktopSessionEvent::Reloading {
                new_socket: Some("/tmp/jcode-reload-event-loop-test.sock".to_string()),
            },
            session_launch::DesktopSessionEvent::Reloaded {
                session_id: "reload-model-session".to_string(),
            },
            session_launch::DesktopSessionEvent::TextDelta("resumed".to_string()),
            session_launch::DesktopSessionEvent::Done,
        ],
    );

    assert_eq!(drained, Some("next".to_string()));
    let DesktopApp::SingleSession(app) = &desktop else {
        unreachable!();
    };
    assert!(app.queued_draft_messages().is_empty());
    assert!(
        app.is_processing,
        "draining queued prompt starts the next turn"
    );
}

#[test]
fn single_session_event_loop_auto_drain_allows_done_after_reloaded_without_output() {
    let mut desktop = DesktopApp::SingleSession(SingleSessionApp::new(None));
    let DesktopApp::SingleSession(app) = &mut desktop else {
        unreachable!();
    };
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "working".to_string(),
    ));
    app.is_processing = true;
    app.handle_key(KeyInput::Character("next".to_string()));
    assert_eq!(app.handle_key(KeyInput::QueueDraft), KeyOutcome::Redraw);

    let drained = apply_session_event_batch_then_auto_drain(
        &mut desktop,
        vec![
            session_launch::DesktopSessionEvent::Reloading {
                new_socket: Some("/tmp/jcode-reload-event-loop-test.sock".to_string()),
            },
            session_launch::DesktopSessionEvent::Reloaded {
                session_id: "reload-model-session".to_string(),
            },
            session_launch::DesktopSessionEvent::Done,
        ],
    );

    assert_eq!(drained, Some("next".to_string()));
}

#[test]
fn single_session_event_loop_reload_error_keeps_queue_retryable() {
    let mut desktop = DesktopApp::SingleSession(SingleSessionApp::new(None));
    let DesktopApp::SingleSession(app) = &mut desktop else {
        unreachable!();
    };
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "working".to_string(),
    ));
    app.is_processing = true;
    app.handle_key(KeyInput::Character("retry me".to_string()));
    assert_eq!(app.handle_key(KeyInput::QueueDraft), KeyOutcome::Redraw);

    let drained = apply_session_event_batch_then_auto_drain(
        &mut desktop,
        vec![
            session_launch::DesktopSessionEvent::Reloading {
                new_socket: Some("/tmp/jcode-reload-event-loop-test.sock".to_string()),
            },
            session_launch::DesktopSessionEvent::Error("reload failed".to_string()),
        ],
    );

    assert_eq!(drained, None);
    let DesktopApp::SingleSession(app) = &desktop else {
        unreachable!();
    };
    assert_eq!(app.queued_draft_messages(), vec!["retry me".to_string()]);
    assert!(app.composer_status_line().contains("error"));
    assert!(app.composer_status_line().contains("1 queued"));
}

#[test]
fn single_session_event_loop_multiple_reloads_preserve_queued_prompt_order() {
    let mut desktop = DesktopApp::SingleSession(SingleSessionApp::new(None));
    let DesktopApp::SingleSession(app) = &mut desktop else {
        unreachable!();
    };
    app.is_processing = true;
    app.handle_key(KeyInput::Character("first".to_string()));
    assert_eq!(app.handle_key(KeyInput::QueueDraft), KeyOutcome::Redraw);

    assert_eq!(
        apply_session_event_batch_then_auto_drain(
            &mut desktop,
            vec![
                session_launch::DesktopSessionEvent::Reloading {
                    new_socket: Some("/tmp/jcode-reload-one.sock".to_string()),
                },
                session_launch::DesktopSessionEvent::Reloaded {
                    session_id: "reload-model-session".to_string(),
                },
            ],
        ),
        None
    );

    let DesktopApp::SingleSession(app) = &mut desktop else {
        unreachable!();
    };
    app.handle_key(KeyInput::Character("second".to_string()));
    assert_eq!(app.handle_key(KeyInput::QueueDraft), KeyOutcome::Redraw);
    assert_eq!(
        app.queued_draft_messages(),
        vec!["first".to_string(), "second".to_string()]
    );

    assert_eq!(
        apply_session_event_batch_then_auto_drain(
            &mut desktop,
            vec![
                session_launch::DesktopSessionEvent::Reloading {
                    new_socket: Some("/tmp/jcode-reload-two.sock".to_string()),
                },
                session_launch::DesktopSessionEvent::Reloaded {
                    session_id: "reload-model-session".to_string(),
                },
                session_launch::DesktopSessionEvent::Done,
            ],
        ),
        Some("first".to_string())
    );
    assert_eq!(
        apply_session_event_batch_then_auto_drain(
            &mut desktop,
            vec![session_launch::DesktopSessionEvent::Done],
        ),
        Some("second".to_string())
    );
}

#[test]
fn single_session_reload_queue_golden_trace_waits_for_done_before_drain() {
    run_queue_trace(&[
        QueueTraceAction::Reloading,
        QueueTraceAction::TypeA,
        QueueTraceAction::CtrlEnter,
        QueueTraceAction::SessionStarted,
        QueueTraceAction::TryDrainQueued,
        QueueTraceAction::Done,
        QueueTraceAction::TryDrainQueued,
        QueueTraceAction::Reloaded,
        QueueTraceAction::Done,
        QueueTraceAction::TryDrainQueued,
        QueueTraceAction::TextDelta,
        QueueTraceAction::Done,
        QueueTraceAction::TryDrainQueued,
    ]);
}

#[test]
fn single_session_reload_queue_state_space_matches_reference_model() {
    const ACTIONS: &[QueueTraceAction] = &[
        QueueTraceAction::TypeA,
        QueueTraceAction::TypeB,
        QueueTraceAction::CtrlEnter,
        QueueTraceAction::Reloading,
        QueueTraceAction::Reloaded,
        QueueTraceAction::SessionStarted,
        QueueTraceAction::TextDelta,
        QueueTraceAction::Done,
        QueueTraceAction::Error,
        QueueTraceAction::TryDrainQueued,
    ];

    fn visit(trace: &mut Vec<QueueTraceAction>, depth_remaining: usize) {
        run_queue_trace(trace);
        if depth_remaining == 0 {
            return;
        }
        for &action in ACTIONS {
            trace.push(action);
            visit(trace, depth_remaining - 1);
            trace.pop();
        }
    }

    let mut trace = Vec::new();
    visit(&mut trace, 5);
}

#[test]
fn single_session_paste_text_preserves_spaces() {
    let mut app = SingleSessionApp::new(None);
    app.paste_text("hello  pasted");
    assert_eq!(app.draft, "hello  pasted");
}

#[test]
fn clipboard_text_normalization_preserves_whitespace_but_unifies_newlines() {
    assert_eq!(normalize_clipboard_text("a\r\nb\rc  "), "a\nb\nc  ");
    assert_eq!(
        normalize_clipboard_text("  padded\ttext  "),
        "  padded\ttext  "
    );
}

#[test]
fn paste_clipboard_text_inserts_at_cursor_and_supports_undo() {
    let mut desktop = DesktopApp::SingleSession(SingleSessionApp::new(None));
    let DesktopApp::SingleSession(app) = &mut desktop else {
        unreachable!();
    };
    app.handle_key(KeyInput::Character("hello world".to_string()));
    app.draft_cursor = "hello".len();

    assert!(paste_clipboard_text(&mut desktop, "\r\n  pasted  "));
    let DesktopApp::SingleSession(app) = &mut desktop else {
        unreachable!();
    };
    assert_eq!(app.draft, "hello\n  pasted   world");
    assert_eq!(app.draft_cursor, "hello\n  pasted  ".len());

    assert_eq!(app.handle_key(KeyInput::UndoInput), KeyOutcome::Redraw);
    assert_eq!(app.draft, "hello world");
    assert_eq!(app.draft_cursor, "hello".len());
}

#[test]
fn paste_clipboard_text_routes_to_interactive_stdin_response() {
    let mut desktop = DesktopApp::SingleSession(SingleSessionApp::new(None));
    let DesktopApp::SingleSession(app) = &mut desktop else {
        unreachable!();
    };
    app.apply_session_event(session_launch::DesktopSessionEvent::StdinRequest {
        request_id: "stdin-1".to_string(),
        prompt: "Password:".to_string(),
        is_password: true,
        tool_call_id: "tool-1".to_string(),
    });

    assert!(paste_clipboard_text(&mut desktop, "secret\r\nline"));
    let DesktopApp::SingleSession(app) = &desktop else {
        unreachable!();
    };
    assert_eq!(app.stdin_response.as_ref().unwrap().input, "secret\nline");
    assert!(app.draft.is_empty());
}

#[test]
fn paste_clipboard_text_ignores_empty_text_so_image_fallback_can_run() {
    let mut desktop = DesktopApp::SingleSession(SingleSessionApp::new(None));
    assert!(!paste_clipboard_text(&mut desktop, ""));
    let DesktopApp::SingleSession(app) = &desktop else {
        unreachable!();
    };
    assert!(app.draft.is_empty());
}

#[test]
fn single_session_character_selection_extracts_visible_text() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::user("first"));
    app.messages
        .push(SingleSessionMessage::assistant("second  \nthird"));
    let lines = app.body_lines();
    let second_line = lines
        .iter()
        .position(|line| line == "second")
        .expect("second assistant line");
    let third_line = second_line + 1;

    app.begin_selection(SelectionPoint {
        line: second_line,
        column: 1,
    });
    app.update_selection(SelectionPoint {
        line: third_line,
        column: 2,
    });

    assert_eq!(
        app.selected_text_from_lines(&lines),
        Some(format!(
            "{}\n{}",
            &lines[second_line][1..],
            &lines[third_line][..2]
        ))
    );
    assert_eq!(
        app.selection_segments(&lines),
        vec![
            SelectionLineSegment {
                line: second_line,
                start_column: 1,
                end_column: lines[second_line].chars().count()
            },
            SelectionLineSegment {
                line: third_line,
                start_column: 0,
                end_column: 2
            }
        ]
    );
}

#[test]
fn single_session_character_selection_handles_reverse_unicode_selection() {
    let mut app = SingleSessionApp::new(None);
    let lines = vec!["hello 🦀 world".to_string()];

    app.begin_selection(SelectionPoint { line: 0, column: 9 });
    app.update_selection(SelectionPoint { line: 0, column: 6 });

    assert_eq!(
        app.selected_text_from_lines(&lines),
        Some("🦀 w".to_string())
    );
}

#[test]
fn single_session_body_line_at_y_maps_transcript_region() {
    let size = PhysicalSize::new(800, 600);
    assert_eq!(
        single_session_body_line_at_y(size, PANEL_BODY_TOP_PADDING + 1.0),
        Some(0)
    );
    assert_eq!(single_session_body_line_at_y(size, 1.0), None);
}

#[test]
fn single_session_body_point_at_position_maps_x_to_character_column() {
    let size = PhysicalSize::new(800, 600);
    let lines = vec!["abcdef".to_string()];
    let y = PANEL_BODY_TOP_PADDING + 1.0;
    let char_width = single_session_body_char_width();

    assert_eq!(
        single_session_body_point_at_position(size, PANEL_TITLE_LEFT_PADDING - 4.0, y, &lines),
        Some(SelectionPoint { line: 0, column: 0 })
    );
    assert_eq!(
        single_session_body_point_at_position(
            size,
            PANEL_TITLE_LEFT_PADDING + char_width * 2.4,
            y,
            &lines
        ),
        Some(SelectionPoint { line: 0, column: 2 })
    );
    assert_eq!(
        single_session_body_point_at_position(
            size,
            PANEL_TITLE_LEFT_PADDING + char_width * 99.0,
            y,
            &lines
        ),
        Some(SelectionPoint { line: 0, column: 6 })
    );
}

#[test]
fn single_session_draft_point_at_position_maps_to_cursor_line_column() {
    let size = PhysicalSize::new(900, 700);
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello\nworld".to_string()));
    let typography = single_session_typography_for_scale(app.text_scale());
    let char_width = typography.code_size * 0.58;
    let line_height = typography.code_size * typography.code_line_height;
    let draft_top = single_session_draft_top_for_app(&app, size);
    let prompt_columns = app.composer_prompt().chars().count() as f32;

    assert_eq!(
        single_session_draft_line_col_at_position(
            &app,
            size,
            PANEL_TITLE_LEFT_PADDING + (prompt_columns + 2.0) * char_width,
            draft_top + line_height * 0.5,
        ),
        Some((0, 2))
    );
    assert_eq!(
        single_session_draft_line_col_at_position(
            &app,
            size,
            PANEL_TITLE_LEFT_PADDING + 3.0 * char_width,
            draft_top + line_height * 1.5,
        ),
        Some((1, 3))
    );

    app.set_draft_cursor_line_col(1, 3);
    assert_eq!(app.draft_cursor, "hello\nwor".len());
}

#[test]
fn single_session_prompt_jump_moves_between_user_turns() {
    let mut app = SingleSessionApp::new(None);
    for index in 0..4 {
        app.messages
            .push(SingleSessionMessage::user(format!("question {index}")));
        app.messages
            .push(SingleSessionMessage::assistant(format!("answer {index}")));
    }

    assert_eq!(app.body_scroll_lines, 0.0);
    assert_eq!(app.handle_key(KeyInput::JumpPrompt(-1)), KeyOutcome::Redraw);
    assert!(app.body_scroll_lines > 0.0);
    let older_scroll = app.body_scroll_lines;

    assert_eq!(app.handle_key(KeyInput::JumpPrompt(1)), KeyOutcome::Redraw);
    assert!(app.body_scroll_lines < older_scroll || app.body_scroll_lines == 0.0);
}

#[test]
fn single_session_copy_latest_response_prefers_streaming_text() {
    let mut app = SingleSessionApp::new(None);
    app.messages
        .push(SingleSessionMessage::assistant("completed answer"));
    assert_eq!(
        app.handle_key(KeyInput::CopyLatestResponse),
        KeyOutcome::CopyLatestResponse("completed answer".to_string())
    );

    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "streaming answer".to_string(),
    ));
    assert_eq!(
        app.handle_key(KeyInput::CopyLatestResponse),
        KeyOutcome::CopyLatestResponse("streaming answer".to_string())
    );
}

#[test]
fn single_session_streaming_preserves_manual_scroll_but_submit_follows_bottom() {
    let mut app = SingleSessionApp::new(None);
    app.messages.push(SingleSessionMessage::user("older"));
    app.messages
        .push(SingleSessionMessage::assistant("older answer"));
    app.scroll_body_lines(12.0);

    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "new token".to_string(),
    ));
    assert_eq!(app.body_scroll_lines, 12.0);

    app.handle_key(KeyInput::Character("new prompt".to_string()));
    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::StartFreshSession {
            message: "new prompt".to_string(),
            images: Vec::new()
        }
    );
    assert_eq!(app.body_scroll_lines, 0.0);
}

#[test]
fn single_session_applies_live_server_events_to_visible_body() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello".to_string()));
    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::StartFreshSession {
            message: "hello".to_string(),
            images: Vec::new()
        }
    );
    app.apply_session_event(session_launch::DesktopSessionEvent::SessionStarted {
        session_id: "session_desktop_live_123".to_string(),
    });
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "hi".to_string(),
    ));

    let live_lines = app.body_lines().join("\n");
    assert!(live_lines.contains("1  hello"));
    assert!(live_lines.contains("hi"));
    assert!(!live_lines.contains("user:"));
    assert!(!live_lines.contains("assistant:"));
    assert!(!live_lines.contains("status:"));
    assert!(app.has_background_work());

    app.apply_session_event(session_launch::DesktopSessionEvent::Done);
    assert!(!app.has_background_work());
    let completed_lines = app.body_lines().join("\n");
    assert!(completed_lines.contains("1  hello"));
    assert!(completed_lines.contains("hi"));
    assert!(!completed_lines.contains("assistant:"));
}

#[test]
fn desktop_app_drains_session_events_into_visible_debug_snapshot() {
    let mut app = fresh_single_session_app();
    assert_eq!(
        app.handle_key(KeyInput::Character("hello smoke".to_string())),
        KeyOutcome::Redraw
    );
    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::StartFreshSession {
            message: "hello smoke".to_string(),
            images: Vec::new()
        }
    );

    let (event_tx, event_rx) = mpsc::channel();
    event_tx
        .send(session_launch::DesktopSessionEvent::SessionStarted {
            session_id: "session_visible_smoke".to_string(),
        })
        .unwrap();
    event_tx
        .send(session_launch::DesktopSessionEvent::TextDelta(
            "visible assistant response".to_string(),
        ))
        .unwrap();
    assert!(apply_pending_session_events(&mut app, &event_rx));

    let streaming = app.debug_snapshot();
    assert_eq!(streaming.mode, "single_session");
    assert_eq!(
        streaming.live_session_id.as_deref(),
        Some("session_visible_smoke")
    );
    assert!(streaming.is_processing);
    assert!(streaming.body_text.contains("1  hello smoke"));
    assert!(streaming.body_text.contains("visible assistant response"));
    assert!(!streaming.body_text.contains("user:"));
    assert!(!streaming.body_text.contains("assistant:"));
    assert!(!streaming.body_text.contains("status:"));

    event_tx
        .send(session_launch::DesktopSessionEvent::Done)
        .unwrap();
    assert!(apply_pending_session_events(&mut app, &event_rx));
    let completed = app.debug_snapshot();
    assert!(!completed.is_processing);
    assert_eq!(completed.status.as_deref(), Some("ready"));
    assert!(completed.body_text.contains("visible assistant response"));
    assert!(!completed.body_text.contains("assistant:"));
}

#[test]
fn headless_chat_smoke_message_parses_hidden_flag() {
    assert_eq!(
        headless_chat_smoke_message(&[
            "jcode-desktop".to_string(),
            "--headless-chat-smoke".to_string(),
            "reply pong".to_string(),
        ]),
        Some("reply pong".to_string())
    );
    assert_eq!(
        headless_chat_smoke_message(&[
            "jcode-desktop".to_string(),
            "--headless-chat-smoke=reply pong".to_string(),
        ]),
        Some("reply pong".to_string())
    );
    assert_eq!(
        headless_chat_smoke_message(&["jcode-desktop".to_string()]),
        None
    );
}

#[test]
fn desktop_help_text_documents_desktop_options() {
    let help = desktop_help_text();

    assert!(help.contains("Usage:"));
    assert!(help.contains("--fullscreen"));
    assert!(help.contains("--workspace"));
    assert!(help.contains("--startup-log"));
    assert!(help.contains("--startup-benchmark"));
    assert!(help.contains("--headless-chat-smoke <MSG>"));
    assert!(help.contains("--version"));
    assert!(help.contains("--help"));
}

#[test]
fn desktop_startup_flags_enable_logging_and_benchmark_mode() {
    let args = vec!["jcode-desktop".to_string(), "--startup-log".to_string()];
    assert!(startup_log_requested(&args));
    assert!(!startup_benchmark_requested(&args));

    let args = vec![
        "jcode-desktop".to_string(),
        "--startup-benchmark".to_string(),
    ];
    assert!(startup_benchmark_requested(&args));
    assert!(!startup_log_requested(&["jcode-desktop".to_string()]));

    assert!(env_flag_enabled(OsString::from("1")));
    assert!(!env_flag_enabled(OsString::from("false")));
}

#[test]
fn single_session_reload_event_keeps_worker_state_processing() {
    let mut app = SingleSessionApp::new(None);
    app.apply_session_event(session_launch::DesktopSessionEvent::Reloading {
        new_socket: Some("/tmp/jcode-reload.sock".to_string()),
    });

    assert!(app.has_background_work());
    assert!(app.body_lines().join("\n").contains("server reloading"));
}

#[test]
fn single_session_scrollback_virtualizes_visible_body_lines() {
    let mut app = SingleSessionApp::new(None);
    for index in 0..32 {
        app.apply_session_event(session_launch::DesktopSessionEvent::TextReplace(format!(
            "message {index}"
        )));
        app.apply_session_event(session_launch::DesktopSessionEvent::Done);
    }
    let size = PhysicalSize::new(640, 480);

    let bottom = single_session_visible_body(&app, size).join("\n");
    assert!(bottom.contains("message 31"));
    assert!(!bottom.contains("message 0"));

    app.scroll_body_lines(24.0);
    let older = single_session_visible_body(&app, size).join("\n");
    assert!(older.contains("message 0") || older.contains("message 1"));
}

#[test]
fn mouse_scroll_delta_maps_to_body_scroll_lines() {
    assert_eq!(
        mouse_scroll_lines(MouseScrollDelta::LineDelta(0.0, 1.0)),
        Some(3.0)
    );
    assert_eq!(
        mouse_scroll_lines(MouseScrollDelta::LineDelta(0.0, -1.0)),
        Some(-3.0)
    );
}

#[test]
fn pixel_scroll_deltas_preserve_fractional_lines() {
    let mut accumulator = ScrollLineAccumulator::default();
    let now = Instant::now();
    let half_line = body_scroll_line_pixels() as f64 * 0.5;

    assert_eq!(
        accumulator.scroll_lines(
            MouseScrollDelta::PixelDelta(winit::dpi::PhysicalPosition::new(0.0, half_line)),
            now,
        ),
        Some(0.5)
    );
    assert_eq!(
        accumulator.scroll_lines(
            MouseScrollDelta::PixelDelta(winit::dpi::PhysicalPosition::new(0.0, half_line)),
            now + Duration::from_millis(16),
        ),
        Some(0.5)
    );
}

#[test]
fn scroll_accumulator_keeps_fractional_momentum_after_wheel_input() {
    let mut accumulator = ScrollLineAccumulator::default();
    let now = Instant::now();

    assert_eq!(
        accumulator.scroll_lines(MouseScrollDelta::LineDelta(0.0, 1.0), now),
        Some(3.0)
    );
    assert!(accumulator.is_active());

    let frame = accumulator.frame(now + Duration::from_millis(16));
    assert!(
        frame.active,
        "momentum should continue after the input event"
    );
    assert!(
        frame
            .scroll_lines
            .is_some_and(|lines| lines.abs() >= SCROLL_FRACTIONAL_EPSILON),
        "momentum should emit fractional scroll lines"
    );
}

#[test]
fn pixel_scroll_reversal_and_idle_reset_keep_fractional_deltas() {
    let mut accumulator = ScrollLineAccumulator::default();
    let now = Instant::now();
    let three_quarters = body_scroll_line_pixels() as f64 * 0.75;
    let half_line = body_scroll_line_pixels() as f64 * 0.5;

    assert_eq!(
        accumulator.scroll_lines(
            MouseScrollDelta::PixelDelta(winit::dpi::PhysicalPosition::new(0.0, three_quarters)),
            now,
        ),
        Some(0.75)
    );
    assert_eq!(
        accumulator.scroll_lines(
            MouseScrollDelta::PixelDelta(winit::dpi::PhysicalPosition::new(0.0, -half_line)),
            now + Duration::from_millis(16),
        ),
        Some(-0.5)
    );
    assert_eq!(
        accumulator.scroll_lines(
            MouseScrollDelta::PixelDelta(winit::dpi::PhysicalPosition::new(0.0, -half_line)),
            now + Duration::from_millis(32),
        ),
        Some(-0.5)
    );

    assert_eq!(
        accumulator.scroll_lines(
            MouseScrollDelta::PixelDelta(winit::dpi::PhysicalPosition::new(0.0, three_quarters)),
            now + Duration::from_millis(48),
        ),
        Some(0.75)
    );
    assert_eq!(
        accumulator.scroll_lines(
            MouseScrollDelta::PixelDelta(winit::dpi::PhysicalPosition::new(0.0, three_quarters)),
            now + SCROLL_GESTURE_IDLE_RESET + Duration::from_millis(80),
        ),
        Some(0.75)
    );
}

#[test]
fn mouse_scroll_clamps_to_available_single_session_history() {
    let mut app = SingleSessionApp::new(None);
    let size = PhysicalSize::new(900, 360);
    for index in 0..48 {
        app.messages
            .push(SingleSessionMessage::assistant(format!("message {index}")));
    }
    let mut desktop = DesktopApp::SingleSession(app);
    let mut metrics_cache = SingleSessionScrollMetricsCache::default();

    assert!(desktop.scroll_single_session_body(10_000.0, size, &mut metrics_cache));
    let DesktopApp::SingleSession(app) = &desktop else {
        unreachable!();
    };
    let max_scroll = single_session_body_scroll_metrics(app, size, 0)
        .expect("scroll metrics")
        .max_scroll_lines;
    assert_eq!(app.body_scroll_lines, max_scroll as f32);

    assert!(desktop.scroll_single_session_body(-1.0, size, &mut metrics_cache));
    let DesktopApp::SingleSession(app) = &desktop else {
        unreachable!();
    };
    assert_eq!(app.body_scroll_lines, max_scroll as f32 - 1.0);
}

#[test]
fn fractional_scroll_viewport_keeps_fractional_line_offset() {
    let mut app = SingleSessionApp::new(None);
    let size = PhysicalSize::new(900, 360);
    for index in 0..48 {
        app.messages
            .push(SingleSessionMessage::assistant(format!("message {index}")));
    }

    let normal = single_session_body_viewport_for_tick(&app, size, 0, 0.0);
    app.scroll_body_lines(0.5);
    let fractional = single_session_body_viewport_for_tick(&app, size, 0, 0.0);

    assert!(fractional.top_offset_pixels < 0.0);
    assert_eq!(fractional.lines.len(), normal.lines.len() + 1);
    assert_eq!(&fractional.lines[1..], normal.lines.as_slice());
}

#[test]
fn fractional_scroll_offsets_body_text_area_without_moving_chrome() {
    let mut app = SingleSessionApp::new(Some(test_session_card(
        "session_smooth",
        "smooth",
        "active",
    )));
    let size = PhysicalSize::new(900, 360);
    for index in 0..48 {
        app.messages
            .push(SingleSessionMessage::assistant(format!("message {index}")));
    }
    let mut fractional_app = app.clone();
    fractional_app.scroll_body_lines(0.5);
    let mut font_system = FontSystem::new();
    let key = single_session_text_key(&fractional_app, size);
    let buffers = single_session_text_buffers_from_key(&key, size, &mut font_system);
    let normal_areas = single_session_text_areas_for_app_with_scroll(&app, &buffers, size, 0, 0.0);
    let fractional_areas =
        single_session_text_areas_for_app_with_scroll(&fractional_app, &buffers, size, 0, 0.0);

    let normal_body = normal_areas
        .iter()
        .find(|area| area.bounds.top == PANEL_BODY_TOP_PADDING as i32)
        .expect("normal body text area");
    let fractional_body = fractional_areas
        .iter()
        .find(|area| area.bounds.top == PANEL_BODY_TOP_PADDING as i32)
        .expect("fractional body text area");
    let normal_title = normal_areas
        .iter()
        .find(|area| area.top == PANEL_TITLE_TOP_PADDING && area.bounds.bottom == 64)
        .expect("normal title text area");
    let fractional_title = fractional_areas
        .iter()
        .find(|area| area.top == PANEL_TITLE_TOP_PADDING && area.bounds.bottom == 64)
        .expect("fractional title text area");

    assert_eq!(normal_title.top, PANEL_TITLE_TOP_PADDING);
    assert_eq!(fractional_title.top, PANEL_TITLE_TOP_PADDING);
    assert_eq!(normal_body.top, PANEL_BODY_TOP_PADDING);
    assert!(fractional_body.top < normal_body.top);
}

#[test]
fn welcome_timeline_body_reserves_composer_lane_clearance() {
    let size = PhysicalSize::new(900, 640);
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello desktop".to_string()));
    assert!(matches!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::StartFreshSession { .. }
    ));
    app.apply_session_event(session_launch::DesktopSessionEvent::TextDelta(
        "assistant response".to_string(),
    ));

    let mut font_system = FontSystem::new();
    let buffers = single_session_text_buffers(&app, size, &mut font_system);
    let areas = single_session_text_areas_for_app(&app, &buffers, size);
    let typography = single_session_typography();
    let line_height = typography.body_size * typography.body_line_height;
    let status_lane = areas.first().expect("status lane text area");
    let body_area = areas
        .iter()
        .find(|area| area.bounds.top == PANEL_BODY_TOP_PADDING as i32)
        .expect("welcome timeline body text area");
    let body_bottom = body_area.bounds.bottom as f32;
    let composer_top = status_lane.top;

    assert!(
        composer_top - body_bottom >= line_height - 1.0,
        "body text should reserve at least one transcript line before composer/status lane: body_bottom={body_bottom}, composer_top={composer_top}, line_height={line_height}"
    );
}

#[test]
fn single_session_visible_body_wraps_long_assistant_lines() {
    let mut app = SingleSessionApp::new(Some(test_session_card("session_wrap", "wrap", "active")));
    app.messages.push(SingleSessionMessage::assistant(
        "This assistant response should wrap cleanly within the desktop transcript column instead of running horizontally forever."
    ));
    let size = PhysicalSize::new(360, 480);

    let raw = app.body_styled_lines();
    let visible = single_session_visible_body(&app, size);

    assert_eq!(raw.len(), 1, "model transcript remains one logical line");
    assert!(
        visible.len() > raw.len(),
        "rendered body should split long assistant text into visual lines: {:?}",
        visible
    );
    assert!(visible.iter().all(|line| line.chars().count() <= 40));
}

#[test]
fn long_single_session_transcript_exposes_scrollbar_metrics() {
    let mut app = SingleSessionApp::new(None);
    let size = PhysicalSize::new(900, 360);
    for index in 0..48 {
        app.messages
            .push(SingleSessionMessage::assistant(format!("message {index}")));
    }

    let metrics = single_session_body_scroll_metrics(&app, size, 0).expect("scroll metrics");
    assert!(metrics.total_lines > metrics.visible_lines);
    assert!(metrics.max_scroll_lines > 0);

    let vertices = build_single_session_vertices(&app, size, 0.0, 0);
    assert!(
        vertices
            .iter()
            .any(|vertex| vertex.color == [0.035, 0.065, 0.145, 0.34])
    );
}

#[test]
fn glyphon_caret_position_uses_shaped_draft_buffer() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello".to_string()));
    let size = PhysicalSize::new(640, 480);
    let mut font_system = FontSystem::new();
    let buffers = single_session_text_buffers(&app, size, &mut font_system);

    let caret = glyphon_draft_caret_position(&app, &buffers[2], size)
        .expect("caret position should be available from glyphon layout runs");

    assert!(caret.x > PANEL_TITLE_LEFT_PADDING);
    assert!(caret.y >= single_session_draft_top_for_app(&app, size));
}

#[test]
fn fresh_welcome_uses_dominant_hero_composer_while_drafting() {
    let size = PhysicalSize::new(1000, 720);
    let mut app = SingleSessionApp::new(None);
    let mut font_system = FontSystem::new();
    let buffers = single_session_text_buffers(&app, size, &mut font_system);
    let areas = single_session_text_areas_for_app(&app, &buffers, size);

    assert_eq!(
        areas.first().expect("draft text area").top,
        fresh_welcome_draft_top(size)
    );
    assert_eq!(areas.len(), 5, "fresh welcome hides normal status chrome");
    assert!(
        areas.first().expect("draft text area").top > handwritten_welcome_bounds(size).1[1],
        "fresh input line should stay visually below the handwritten hero"
    );
    let hero_bottom = handwritten_welcome_bounds(size).1[1];
    let version_area = areas
        .iter()
        .find(|area| area.top > hero_bottom && area.top < fresh_welcome_draft_top(size))
        .expect("version label should sit between hero and composer");
    assert!(
        version_area.top - hero_bottom >= 29.0,
        "version label needs enough clearance from handwriting strokes"
    );

    app.handle_key(KeyInput::Character("hello".to_string()));
    let key = single_session_text_key(&app, size);
    assert!(app.is_fresh_welcome_visible());
    assert_is_handwritten_welcome_phrase(&key.welcome_hero);
    assert_visual_text_contains(&key, &key.welcome_hero);
    assert_eq!(
        single_session_draft_top_for_app(&app, size),
        fresh_welcome_draft_top(size)
    );
}

#[test]
fn completed_welcome_hero_hands_off_to_clean_font_overlay() {
    let size = PhysicalSize::new(1000, 720);
    let app = SingleSessionApp::new(None);
    let mut font_system = FontSystem::new();
    let buffers = single_session_text_buffers(&app, size, &mut font_system);

    let completed_vertices =
        build_single_session_vertices_with_scroll_and_reveal(&app, size, 0.0, 0, 0.0, 1.0);
    let completed_areas = single_session_text_areas_for_app(&app, &buffers, size);

    assert!(!vertices_have_color(
        &completed_vertices,
        WELCOME_HANDWRITING_COLOR
    ));
    assert!(
        completed_areas
            .iter()
            .any(|area| std::ptr::eq(area.buffer, &buffers[6])),
        "completed reveal should hand off from vector handwriting to the clean shaped text overlay"
    );
}

#[test]
fn fresh_welcome_model_picker_only_reserves_inline_lane() {
    let size = PhysicalSize::new(1000, 720);
    let mut app = SingleSessionApp::new(None);

    assert_eq!(
        app.handle_key(KeyInput::Character("/model opus".to_string())),
        KeyOutcome::LoadModelCatalog
    );

    let key = single_session_text_key(&app, size);
    assert!(
        key.fresh_welcome_visible,
        "inline model picker should not hide the welcome hero"
    );
    assert_is_handwritten_welcome_phrase(&key.welcome_hero);
    assert_visual_text_contains(&key, &key.welcome_hero);
    assert!(
        key.body.is_empty(),
        "model picker status should not become transcript/body text"
    );
    assert!(
        key.inline_widget
            .iter()
            .any(|line| line.text.contains("MODEL"))
    );
    assert_eq!(
        single_session_draft_top_for_app(&app, size),
        single_session_draft_top(size),
        "inline picker should move the composer to the normal bottom input lane"
    );

    let mut font_system = FontSystem::new();
    let buffers = single_session_text_buffers(&app, size, &mut font_system);
    let areas = single_session_text_areas_for_app(&app, &buffers, size);
    let draft_area = areas.first().expect("draft text area");
    assert_eq!(draft_area.top, single_session_draft_top(size));
    let inline_area = areas.last().expect("inline model picker text area");
    assert!(
        inline_area.top < draft_area.top,
        "fresh inline picker should render above the typed /model command"
    );
    assert!(
        inline_area.top > handwritten_welcome_bounds(size).1[1],
        "fresh inline picker must not overlap the handwritten welcome hero"
    );
    assert!(
        inline_area.bounds.bottom > inline_area.bounds.top,
        "fresh inline picker should keep a visible clipped lane"
    );
}

#[test]
fn fresh_submit_keeps_single_visual_timeline_without_transcript_greeting() {
    let size = PhysicalSize::new(1000, 720);
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello desktop".to_string()));
    assert!(matches!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::StartFreshSession { .. }
    ));

    let mut font_system = FontSystem::new();
    let buffers = single_session_text_buffers(&app, size, &mut font_system);
    let areas = single_session_text_areas_for_app(&app, &buffers, size);
    let key = single_session_text_key(&app, size);
    let mut vertices = build_single_session_vertices(&app, size, 0.0, 0);
    push_single_session_caret(&mut vertices, &app, size, buffers.get(2));

    assert_eq!(key.title, "");
    assert_is_handwritten_welcome_phrase(&key.welcome_hero);
    assert!(key.status.contains("sending"));
    assert!(key.status.contains("Esc interrupt"));
    assert_visual_text_contains(&key, &key.welcome_hero);
    assert!(vertices_have_color(&vertices, WELCOME_AURORA_BLUE));
    assert!(vertices_have_color(&vertices, WELCOME_HANDWRITING_COLOR));
    assert!(vertices_have_color(&vertices, NATIVE_SPINNER_HEAD_COLOR));
    assert!(
        key.body
            .iter()
            .any(|line| line.text.contains("hello desktop"))
    );
    let submitted_index = key
        .body
        .iter()
        .position(|line| line.text.contains("hello desktop"))
        .expect("submitted prompt should remain visible in the timeline");
    assert!(
        submitted_index > 0
            && key.body[..submitted_index]
                .iter()
                .all(|line| line.text.trim().is_empty()),
        "visual hero spacer should stay before submitted input in the timeline body"
    );
    assert!(
        key.body.iter().all(|line| !HANDWRITTEN_WELCOME_PHRASES
            .iter()
            .any(|phrase| line.text.contains(phrase))),
        "welcome hero must stay visual-only, not become a transcript line"
    );
    assert!(
        areas.len() >= 4,
        "submit should keep welcome timeline chrome instead of switching screens"
    );
    let status_lane = areas.first().expect("status lane should prepare first");
    let body_area = areas
        .iter()
        .find(|area| area.bounds.top == PANEL_BODY_TOP_PADDING as i32)
        .expect("welcome body text area");
    assert_eq!(body_area.top, PANEL_BODY_TOP_PADDING);
    assert!(status_lane.top > body_area.top);
    assert!(status_lane.top >= fresh_welcome_draft_top(size));
    assert!(!vertices_have_color(&vertices, [0.060, 0.085, 0.145, 0.34]));
    assert!(
        !vertices_have_color(&vertices, SINGLE_SESSION_CARET_COLOR),
        "empty post-submit composer lane should become status, not a blank caret"
    );
}

#[test]
fn session_attach_does_not_move_submitted_fresh_layout() {
    let size = PhysicalSize::new(1000, 720);
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello desktop".to_string()));
    assert!(matches!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::StartFreshSession { .. }
    ));
    let mut font_system = FontSystem::new();
    let before_key = single_session_text_key(&app, size);
    let before_buffers = single_session_text_buffers_from_key(&before_key, size, &mut font_system);
    let before_areas = single_session_text_areas_for_app(&app, &before_buffers, size);

    app.replace_session(Some(workspace::SessionCard {
        session_id: "fresh_session".to_string(),
        title: "fresh session".to_string(),
        subtitle: "active".to_string(),
        detail: "1 msg".to_string(),
        preview_lines: Vec::new(),
        detail_lines: Vec::new(),
    }));

    let after_key = single_session_text_key(&app, size);
    let after_buffers = single_session_text_buffers_from_key(&after_key, size, &mut font_system);
    let after_areas = single_session_text_areas_for_app(&app, &after_buffers, size);

    assert_visual_text_contains(&after_key, &after_key.welcome_hero);
    assert_visual_text_contains(&after_key, "hello desktop");
    assert_eq!(
        before_areas.first().unwrap().top,
        after_areas.first().unwrap().top
    );
    assert_eq!(
        before_areas.last().unwrap().top,
        after_areas.last().unwrap().top
    );
}

#[test]
fn long_transcript_keeps_welcome_visual_only() {
    let size = PhysicalSize::new(900, 360);
    let mut app = SingleSessionApp::new(None);
    for index in 0..48 {
        app.messages
            .push(SingleSessionMessage::assistant(format!("message {index}")));
    }

    let bottom = single_session_visible_body(&app, size).join("\n");
    assert!(
        !HANDWRITTEN_WELCOME_PHRASES
            .iter()
            .any(|phrase| bottom.contains(phrase))
    );
    assert!(bottom.contains("message 47"));

    let metrics = single_session_body_scroll_metrics(&app, size, 0).expect("scroll metrics");
    app.scroll_body_lines(metrics.max_scroll_lines as i32);
    let top = single_session_visible_body(&app, size).join("\n");
    let key = single_session_text_key(&app, size);
    let vertices = build_single_session_vertices(&app, size, 0.0, 0);

    assert!(
        !HANDWRITTEN_WELCOME_PHRASES
            .iter()
            .any(|phrase| top.contains(phrase))
    );
    assert!(!top.contains("message 47"));
    assert_is_handwritten_welcome_phrase(&key.welcome_hero);
    assert!(vertices_have_color(&vertices, WELCOME_HANDWRITING_COLOR));
}

#[test]
fn single_session_without_session_is_native_fresh_draft() {
    let mut app = SingleSessionApp::new(None);

    assert!(app.status_title().contains("single session"));
    assert_eq!(
        app.handle_key(KeyInput::SpawnPanel),
        KeyOutcome::SpawnSession
    );
    assert!(
        single_session_lines(None)
            .iter()
            .any(|line| line.contains("shared desktop session runtime"))
    );
    assert!(
        single_session_lines(None)
            .iter()
            .all(|line| !line.contains("execution is connected"))
    );
}

#[test]
fn fresh_single_session_keeps_welcome_model_and_hero_available() {
    let app = SingleSessionApp::new(None);
    let first = single_session_text_key_for_tick(&app, PhysicalSize::new(900, 700), 0);
    let later = single_session_text_key_for_tick(&app, PhysicalSize::new(900, 700), 42);
    let model_lines = app.body_styled_lines();

    assert!(
        model_lines.is_empty(),
        "fresh welcome greeting should be visual-only, not transcript body: {:?}",
        model_lines
    );
    assert_eq!(first.welcome_hero, later.welcome_hero);
    assert_is_handwritten_welcome_phrase(&first.welcome_hero);
    assert!(first.body.is_empty());
    assert!(first.welcome_hint.is_empty());
}

#[test]
fn welcome_name_is_optional_and_sanitized() {
    assert_eq!(
        sanitize_welcome_name("  Jeremy Huang  "),
        Some("Jeremy".to_string())
    );
    assert_eq!(sanitize_welcome_name("unknown"), None);
    assert_eq!(sanitize_welcome_name("   "), None);

    let named = welcome_styled_lines(&Some("Jeremy".to_string()), 0, 0);
    assert_eq!(named[0].text, "Welcome, Jeremy");
    let generic = welcome_styled_lines(&None, 0, 0);
    assert_eq!(generic[0].text, "Hello there");
}

#[test]
fn fresh_single_session_submit_requests_backend_session() {
    let mut app = SingleSessionApp::new(None);
    app.handle_key(KeyInput::Character("hello desktop".to_string()));

    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::StartFreshSession {
            message: "hello desktop".to_string(),
            images: Vec::new()
        }
    );
    assert!(app.draft.is_empty());
}

#[test]
fn default_single_session_app_starts_without_attaching_recent_session() {
    let DesktopApp::SingleSession(mut app) = fresh_single_session_app() else {
        panic!("default desktop app should be single-session mode");
    };

    assert!(app.session.is_none());
    assert_eq!(
        app.handle_key(KeyInput::SpawnPanel),
        KeyOutcome::SpawnSession
    );
}

#[test]
fn desktop_mode_defaults_to_single_session_and_gates_workspace_prototype() {
    assert_eq!(
        desktop_mode_from_args(["jcode-desktop"]),
        DesktopMode::SingleSession
    );
    assert_eq!(
        desktop_mode_from_args(["jcode-desktop", "--workspace"]),
        DesktopMode::WorkspacePrototype
    );
}

#[test]
fn single_session_spawn_resets_to_fresh_native_draft() {
    let card = workspace::SessionCard {
        session_id: "session_alpha".to_string(),
        title: "alpha".to_string(),
        subtitle: "active".to_string(),
        detail: "3 msgs".to_string(),
        preview_lines: Vec::new(),
        detail_lines: Vec::new(),
    };
    let mut app = SingleSessionApp::new(Some(card));
    app.handle_key(KeyInput::Character("draft".to_string()));

    app.reset_fresh_session();

    assert!(app.session.is_none());
    assert!(app.draft.is_empty());
    assert_eq!(app.detail_scroll, 0);
    assert!(app.status_title().contains("fresh session"));
}

#[test]
fn single_session_wraps_one_session_card() {
    let card = workspace::SessionCard {
        session_id: "session_alpha".to_string(),
        title: "alpha".to_string(),
        subtitle: "active".to_string(),
        detail: "3 msgs".to_string(),
        preview_lines: vec!["user hello".to_string()],
        detail_lines: vec!["assistant hi".to_string()],
    };
    let mut app = SingleSessionApp::new(Some(card));

    assert_eq!(app.handle_key(KeyInput::Enter), KeyOutcome::Redraw);
    assert_eq!(app.draft, "\n");
    app.handle_key(KeyInput::Character("draft".to_string()));
    assert_eq!(
        app.handle_key(KeyInput::SubmitDraft),
        KeyOutcome::SendDraft {
            session_id: "session_alpha".to_string(),
            title: "alpha".to_string(),
            message: "draft".to_string(),
            images: Vec::new(),
        }
    );
}

#[test]
fn single_session_surface_is_the_panel_primitive() {
    let card = workspace::SessionCard {
        session_id: "session_alpha".to_string(),
        title: "alpha".to_string(),
        subtitle: "active".to_string(),
        detail: "3 msgs".to_string(),
        preview_lines: Vec::new(),
        detail_lines: Vec::new(),
    };

    let surface = single_session_surface(Some(&card));

    assert_eq!(surface.id, 1);
    assert_eq!(surface.title, "alpha");
    assert_eq!(surface.session_id.as_deref(), Some("session_alpha"));
    assert_eq!((surface.lane, surface.column), (0, 0));
    assert!(
        surface
            .body_lines
            .contains(&"single session mode".to_string())
    );
}

#[test]
fn focused_panel_draft_only_shows_for_focused_insert_panel() {
    let mut workspace = Workspace::from_session_cards(vec![workspace::SessionCard {
        session_id: "a".to_string(),
        title: "alpha".to_string(),
        subtitle: "active".to_string(),
        detail: "1 msg".to_string(),
        preview_lines: Vec::new(),
        detail_lines: Vec::new(),
    }]);
    workspace.handle_key(KeyInput::Character("i".to_string()));
    workspace.handle_key(KeyInput::Character("draft text".to_string()));
    workspace.attach_image("image/png".to_string(), "abc123".to_string());

    assert_eq!(
        focused_panel_draft(&workspace, workspace.focused_id),
        Some("draft text · 1 image".to_string())
    );
    assert_eq!(
        focused_panel_draft(&workspace, workspace.focused_id + 1),
        None
    );
}

#[test]
fn streaming_response_line_count_matches_wrapped_tail_lines() {
    let mut app = SingleSessionApp::new(None);
    app.messages
        .push(SingleSessionMessage::assistant("finished response"));
    app.streaming_response = format!(
        "short line\n{}\nwrapped words {}",
        "x".repeat(512),
        "word ".repeat(96)
    );
    let size = PhysicalSize::new(640, 800);

    let mut rendered_lines = Vec::new();
    append_single_session_streaming_response_rendered_body_lines(&app, size, &mut rendered_lines);

    assert_eq!(
        single_session_streaming_response_rendered_body_line_count(&app, size),
        rendered_lines.len()
    );
}

#[test]
fn rendered_body_cache_key_samples_large_transcript_middle() {
    let mut first = SingleSessionApp::new(None);
    first.messages = (0..64)
        .map(|index| SingleSessionMessage::assistant(format!("assistant message {index:02}")))
        .collect();
    let mut second = first.clone();
    second.messages[34] = SingleSessionMessage::assistant("assistant message XX");
    let size = (1280, 800);

    assert_ne!(
        first.rendered_body_cache_key(size),
        second.rendered_body_cache_key(size)
    );
    assert_ne!(
        first.rendered_body_static_cache_key(size),
        second.rendered_body_static_cache_key(size)
    );
}

#[test]
fn streaming_text_delta_batches_do_not_refresh_session_metadata() {
    let mut app = DesktopApp::SingleSession(SingleSessionApp::new(None));
    app.apply_session_event(session_launch::DesktopSessionEvent::SessionStarted {
        session_id: "session_live".to_string(),
    });

    let stats = apply_desktop_session_event_batch_with_stats(
        &mut app,
        vec![session_launch::DesktopSessionEvent::TextDelta(
            "streaming chunk".to_string(),
        )],
    );

    assert!(stats.visible_changed);
    assert_eq!(stats.text_delta_bytes, "streaming chunk".len());
    assert!(!stats.session_card_refresh_requested);
}

#[test]
fn terminal_session_events_request_async_session_metadata_refresh() {
    let mut app = DesktopApp::SingleSession(SingleSessionApp::new(None));
    app.apply_session_event(session_launch::DesktopSessionEvent::SessionStarted {
        session_id: "session_live".to_string(),
    });

    let stats = apply_desktop_session_event_batch_with_stats(
        &mut app,
        vec![session_launch::DesktopSessionEvent::Done],
    );

    assert!(stats.visible_changed);
    assert!(stats.session_card_refresh_requested);
}

#[test]
fn desktop_preferences_save_is_queued_off_ui_thread() {
    let workspace = Workspace::from_session_cards(vec![workspace::SessionCard {
        session_id: "session_pref".to_string(),
        title: "pref".to_string(),
        subtitle: "active".to_string(),
        detail: "1 msg".to_string(),
        preview_lines: Vec::new(),
        detail_lines: Vec::new(),
    }]);
    let expected = workspace.preferences();
    let (tx, rx) = mpsc::channel();

    queue_desktop_preferences_save(&workspace, &Some(tx));

    assert_eq!(rx.try_recv().ok(), Some(expected));
    assert!(rx.try_recv().is_err());
}
