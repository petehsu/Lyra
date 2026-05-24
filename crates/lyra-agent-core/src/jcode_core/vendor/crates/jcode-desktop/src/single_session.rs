use crate::{
    session_launch::{DesktopModelChoice, DesktopSessionEvent, DesktopSessionHandle},
    workspace,
};
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use workspace::{KeyInput, KeyOutcome};

pub(crate) const SINGLE_SESSION_FONT_FAMILY: &str = "JetBrainsMono Nerd Font";
pub(crate) const SINGLE_SESSION_ASSISTANT_FONT_FAMILY: &str = "Homemade Apple";
pub(crate) const SINGLE_SESSION_FONT_WEIGHT: &str = "Light";
pub(crate) const SINGLE_SESSION_FONT_FALLBACKS: &[&str] = &[
    "JetBrainsMono Nerd Font Mono",
    "JetBrains Mono",
    "monospace",
];
pub(crate) const SINGLE_SESSION_DEFAULT_FONT_SIZE: f32 = 22.0;
pub(crate) const SINGLE_SESSION_TITLE_FONT_SIZE: f32 = SINGLE_SESSION_DEFAULT_FONT_SIZE;
pub(crate) const SINGLE_SESSION_BODY_FONT_SIZE: f32 = SINGLE_SESSION_CODE_FONT_SIZE * 1.5;
pub(crate) const SINGLE_SESSION_META_FONT_SIZE: f32 = SINGLE_SESSION_DEFAULT_FONT_SIZE;
pub(crate) const SINGLE_SESSION_CODE_FONT_SIZE: f32 = SINGLE_SESSION_DEFAULT_FONT_SIZE + 3.0;
pub(crate) const SINGLE_SESSION_BODY_LINE_HEIGHT: f32 = 1.45;
pub(crate) const SINGLE_SESSION_CODE_LINE_HEIGHT: f32 = 1.35;
pub(crate) const SINGLE_SESSION_META_LINE_HEIGHT: f32 = 1.25;
pub(crate) const SINGLE_SESSION_TEXT_SCALE_STEP: f32 = 0.10;
pub(crate) const SINGLE_SESSION_MIN_TEXT_SCALE: f32 = 0.65;
pub(crate) const SINGLE_SESSION_MAX_TEXT_SCALE: f32 = 1.35;
pub(crate) const HANDWRITTEN_WELCOME_PHRASES: &[&str] = &["Hello there"];

const DESKTOP_SLASH_COMMANDS: &[(&str, &str)] = &[
    ("/help", "show desktop shortcuts and slash commands"),
    ("/clear", "clear the visible desktop transcript"),
    ("/new", "reset to a fresh desktop session"),
    ("/sessions", "open the recent session switcher"),
    ("/model [name]", "open model picker or switch to a model"),
    ("/copy", "copy the latest assistant response"),
    ("/stop", "interrupt the running generation"),
    ("/status", "show current desktop session status"),
    ("/quit", "exit the desktop app"),
];

const BODY_CACHE_TEXT_EDGE_BYTES: usize = 256;
const BODY_CACHE_MESSAGE_EDGE_COUNT: usize = 12;
const BODY_CACHE_MESSAGE_MIDDLE_SAMPLE_COUNT: usize = 8;

#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub(crate) struct SingleSessionTypography {
    pub(crate) family: &'static str,
    pub(crate) weight: &'static str,
    pub(crate) fallbacks: &'static [&'static str],
    pub(crate) title_size: f32,
    pub(crate) body_size: f32,
    pub(crate) meta_size: f32,
    pub(crate) code_size: f32,
    pub(crate) body_line_height: f32,
    pub(crate) code_line_height: f32,
    pub(crate) meta_line_height: f32,
}

pub(crate) const fn single_session_typography() -> SingleSessionTypography {
    SingleSessionTypography {
        family: SINGLE_SESSION_FONT_FAMILY,
        weight: SINGLE_SESSION_FONT_WEIGHT,
        fallbacks: SINGLE_SESSION_FONT_FALLBACKS,
        title_size: SINGLE_SESSION_TITLE_FONT_SIZE,
        body_size: SINGLE_SESSION_BODY_FONT_SIZE,
        meta_size: SINGLE_SESSION_META_FONT_SIZE,
        code_size: SINGLE_SESSION_CODE_FONT_SIZE,
        body_line_height: SINGLE_SESSION_BODY_LINE_HEIGHT,
        code_line_height: SINGLE_SESSION_CODE_LINE_HEIGHT,
        meta_line_height: SINGLE_SESSION_META_LINE_HEIGHT,
    }
}

pub(crate) fn single_session_typography_for_scale(scale: f32) -> SingleSessionTypography {
    let base = single_session_typography();
    let scale = scale.clamp(SINGLE_SESSION_MIN_TEXT_SCALE, SINGLE_SESSION_MAX_TEXT_SCALE);
    SingleSessionTypography {
        title_size: base.title_size * scale,
        body_size: base.body_size * scale,
        meta_size: base.meta_size * scale,
        code_size: base.code_size * scale,
        ..base
    }
}

#[derive(Clone, Debug)]
pub(crate) struct SingleSessionApp {
    pub(crate) session: Option<workspace::SessionCard>,
    pub(crate) draft: String,
    pub(crate) draft_cursor: usize,
    pub(crate) detail_scroll: usize,
    pub(crate) live_session_id: Option<String>,
    pub(crate) messages: Vec<SingleSessionMessage>,
    pub(crate) streaming_response: String,
    pub(crate) status: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) is_processing: bool,
    pub(crate) body_scroll_lines: f32,
    pub(crate) show_help: bool,
    pub(crate) show_session_info: bool,
    pub(crate) pending_images: Vec<(String, String)>,
    pub(crate) model_picker: ModelPickerState,
    pub(crate) session_switcher: SessionSwitcherState,
    pub(crate) stdin_response: Option<StdinResponseState>,
    welcome_name: Option<String>,
    recovery_session_count: usize,
    queued_drafts: Vec<(String, Vec<(String, String)>)>,
    selection_anchor: Option<SelectionPoint>,
    selection_focus: Option<SelectionPoint>,
    draft_selection_anchor: Option<SelectionPoint>,
    draft_selection_focus: Option<SelectionPoint>,
    input_undo_stack: Vec<(String, usize)>,
    session_handle: Option<DesktopSessionHandle>,
    active_tool_message_index: Option<usize>,
    active_tool_input_buffer: String,
    reload_phase: ReloadPhase,
    // True for the fresh-start chat that owns the welcome hero as visual UI.
    // The hero must stay out of `body_styled_lines()` so it never becomes part
    // of the persisted/rendered transcript text.
    welcome_timeline: bool,
    welcome_hero_phrase_index: usize,
    text_scale: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReloadPhase {
    Stable,
    AwaitingReconnect,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SelectionPoint {
    pub(crate) line: usize,
    pub(crate) column: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SelectionLineSegment {
    pub(crate) line: usize,
    pub(crate) start_column: usize,
    pub(crate) end_column: usize,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct SingleSessionStyledLine {
    pub(crate) text: String,
    pub(crate) style: SingleSessionLineStyle,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReadOnlyInlineWidget {
    pub(crate) title: String,
    pub(crate) lines: Vec<SingleSessionStyledLine>,
}

impl ReadOnlyInlineWidget {
    fn new(title: impl Into<String>, lines: Vec<SingleSessionStyledLine>) -> Self {
        Self {
            title: title.into(),
            lines,
        }
    }

    fn styled_lines(self) -> Vec<SingleSessionStyledLine> {
        let mut styled = Vec::with_capacity(self.lines.len().saturating_add(2));
        styled.push(styled_line(
            self.title,
            SingleSessionLineStyle::OverlayTitle,
        ));
        if !self.lines.is_empty() {
            styled.push(blank_styled_line());
            styled.extend(self.lines);
        }
        styled
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum SingleSessionLineStyle {
    Assistant,
    AssistantHeading,
    AssistantQuote,
    AssistantTable,
    AssistantLink,
    Code,
    User,
    UserContinuation,
    Tool,
    Meta,
    Status,
    Error,
    OverlayTitle,
    Overlay,
    OverlaySelection,
    Blank,
}

impl SingleSessionStyledLine {
    fn new(text: impl Into<String>, style: SingleSessionLineStyle) -> Self {
        Self {
            text: text.into(),
            style,
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct StdinResponseState {
    pub(crate) request_id: String,
    pub(crate) prompt: String,
    pub(crate) is_password: bool,
    pub(crate) tool_call_id: String,
    pub(crate) input: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ModelPickerState {
    pub(crate) open: bool,
    pub(crate) loading: bool,
    pub(crate) preview: bool,
    pub(crate) filter: String,
    pub(crate) selected: usize,
    pub(crate) column: usize,
    pub(crate) current_model: Option<String>,
    pub(crate) provider_name: Option<String>,
    pub(crate) choices: Vec<DesktopModelChoice>,
    pub(crate) error: Option<String>,
}

impl Default for ModelPickerState {
    fn default() -> Self {
        Self {
            open: false,
            loading: false,
            preview: false,
            filter: String::new(),
            selected: 0,
            column: 0,
            current_model: None,
            provider_name: None,
            choices: Vec::new(),
            error: None,
        }
    }
}

impl ModelPickerState {
    fn open_loading(&mut self) {
        self.open = true;
        self.loading = true;
        self.preview = false;
        self.error = None;
        self.selected = self.current_choice_index().unwrap_or(0);
        self.column = 0;
    }

    fn open_preview_loading(&mut self, filter: String) {
        self.open = true;
        self.loading = true;
        self.preview = true;
        self.filter = filter;
        self.error = None;
        self.selected = self.current_visible_position().unwrap_or(0);
        self.column = 0;
    }

    fn close(&mut self) {
        self.open = false;
        self.loading = false;
        self.preview = false;
        self.error = None;
        self.column = 0;
    }

    fn apply_catalog(
        &mut self,
        current_model: Option<String>,
        provider_name: Option<String>,
        choices: Vec<DesktopModelChoice>,
    ) {
        if current_model.is_some() {
            self.current_model = current_model;
        }
        if provider_name.is_some() {
            self.provider_name = provider_name;
        }
        if !choices.is_empty() {
            self.choices = dedupe_model_choices(choices);
        }
        self.loading = false;
        self.error = None;
        self.ensure_current_choice_present();
        self.selected = self.current_visible_position().unwrap_or(0);
        self.clamp_selection();
        self.column = self.column.min(2);
    }

    fn apply_error(&mut self, error: String) {
        self.open = true;
        self.loading = false;
        self.error = Some(error);
    }

    fn apply_model_change(&mut self, model: String, provider_name: Option<String>) {
        self.current_model = Some(model);
        if provider_name.is_some() {
            self.provider_name = provider_name;
        }
        self.ensure_current_choice_present();
        self.selected = self.current_visible_position().unwrap_or(self.selected);
        self.clamp_selection();
    }

    fn selected_model(&self) -> Option<String> {
        let visible = self.filtered_indices();
        visible
            .get(self.selected)
            .and_then(|index| self.choices.get(*index))
            .map(|choice| choice.model.clone())
    }

    fn move_selection(&mut self, delta: i32) {
        let visible_len = self.filtered_indices().len();
        if visible_len == 0 {
            self.selected = 0;
            return;
        }
        if delta < 0 {
            self.selected = self.selected.saturating_sub(delta.unsigned_abs() as usize);
        } else {
            self.selected = (self.selected + delta as usize).min(visible_len - 1);
        }
    }

    fn push_filter_text(&mut self, text: &str) {
        self.filter.push_str(text);
        self.selected = 0;
        self.column = 0;
    }

    fn pop_filter_char(&mut self) {
        self.filter.pop();
        self.selected = 0;
        self.column = 0;
    }

    fn set_filter(&mut self, filter: String) {
        if self.filter != filter {
            self.filter = filter;
            self.selected = 0;
            self.column = 0;
        }
        self.clamp_selection();
    }

    fn filtered_indices(&self) -> Vec<usize> {
        let query = self.filter.trim().to_lowercase();
        self.choices
            .iter()
            .enumerate()
            .filter_map(|(index, choice)| {
                if query.is_empty() || model_choice_search_text(choice).contains(&query) {
                    Some(index)
                } else {
                    None
                }
            })
            .collect()
    }

    fn current_choice_index(&self) -> Option<usize> {
        let current = self.current_model.as_deref()?;
        self.choices
            .iter()
            .position(|choice| choice.model == current)
    }

    fn current_visible_position(&self) -> Option<usize> {
        let current = self.current_choice_index()?;
        self.filtered_indices()
            .iter()
            .position(|index| *index == current)
    }

    fn clamp_selection(&mut self) {
        let visible_len = self.filtered_indices().len();
        if visible_len == 0 {
            self.selected = 0;
        } else if self.selected >= visible_len {
            self.selected = visible_len - 1;
        }
    }

    fn ensure_current_choice_present(&mut self) {
        let Some(current_model) = self.current_model.clone() else {
            return;
        };
        if self
            .choices
            .iter()
            .any(|choice| choice.model == current_model)
        {
            return;
        }
        self.choices.insert(
            0,
            DesktopModelChoice {
                model: current_model,
                provider: self.provider_name.clone(),
                api_method: Some("current".to_string()),
                detail: Some("current model".to_string()),
                available: true,
            },
        );
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub(crate) struct SessionSwitcherState {
    pub(crate) open: bool,
    pub(crate) loading: bool,
    pub(crate) filter: String,
    pub(crate) selected: usize,
    pub(crate) sessions: Vec<workspace::SessionCard>,
}

impl SessionSwitcherState {
    fn open_loading(&mut self, current_session_id: Option<&str>) {
        self.open = true;
        self.loading = true;
        self.selected = self
            .current_visible_position(current_session_id)
            .unwrap_or(self.selected);
        self.clamp_selection();
    }

    fn close(&mut self) {
        self.open = false;
        self.loading = false;
    }

    fn apply_sessions(
        &mut self,
        sessions: Vec<workspace::SessionCard>,
        current_session_id: Option<&str>,
    ) {
        self.sessions = sessions;
        self.loading = false;
        self.selected = self
            .current_visible_position(current_session_id)
            .unwrap_or(0);
        self.clamp_selection();
    }

    fn selected_session(&self) -> Option<workspace::SessionCard> {
        let visible = self.filtered_indices();
        visible
            .get(self.selected)
            .and_then(|index| self.sessions.get(*index))
            .cloned()
    }

    fn move_selection(&mut self, delta: i32) {
        let visible_len = self.filtered_indices().len();
        if visible_len == 0 {
            self.selected = 0;
            return;
        }
        if delta < 0 {
            self.selected = self.selected.saturating_sub(delta.unsigned_abs() as usize);
        } else {
            self.selected = (self.selected + delta as usize).min(visible_len - 1);
        }
    }

    fn push_filter_text(&mut self, text: &str) {
        self.filter.push_str(text);
        self.selected = 0;
    }

    fn pop_filter_char(&mut self) {
        self.filter.pop();
        self.selected = 0;
    }

    fn filtered_indices(&self) -> Vec<usize> {
        let query = self.filter.trim().to_lowercase();
        self.sessions
            .iter()
            .enumerate()
            .filter_map(|(index, session)| {
                if query.is_empty() || session_card_search_text(session).contains(&query) {
                    Some(index)
                } else {
                    None
                }
            })
            .collect()
    }

    fn current_visible_position(&self, current_session_id: Option<&str>) -> Option<usize> {
        let current_session_id = current_session_id?;
        self.filtered_indices().iter().position(|index| {
            self.sessions
                .get(*index)
                .is_some_and(|session| session.session_id == current_session_id)
        })
    }

    fn clamp_selection(&mut self) {
        let visible_len = self.filtered_indices().len();
        if visible_len == 0 {
            self.selected = 0;
        } else if self.selected >= visible_len {
            self.selected = visible_len - 1;
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct SingleSessionMessage {
    role: SingleSessionRole,
    content: String,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
#[allow(dead_code)]
pub(crate) enum SingleSessionRole {
    User,
    Assistant,
    Tool,
    System,
    Meta,
}

impl SingleSessionRole {
    pub(crate) fn is_user(self) -> bool {
        matches!(self, Self::User)
    }
}

impl SingleSessionMessage {
    pub(crate) fn user(content: impl Into<String>) -> Self {
        Self {
            role: SingleSessionRole::User,
            content: content.into(),
        }
    }

    pub(crate) fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: SingleSessionRole::Assistant,
            content: content.into(),
        }
    }

    pub(crate) fn tool(content: impl Into<String>) -> Self {
        Self {
            role: SingleSessionRole::Tool,
            content: content.into(),
        }
    }

    #[allow(dead_code)]
    pub(crate) fn system(content: impl Into<String>) -> Self {
        Self {
            role: SingleSessionRole::System,
            content: content.into(),
        }
    }

    #[allow(dead_code)]
    pub(crate) fn meta(content: impl Into<String>) -> Self {
        Self {
            role: SingleSessionRole::Meta,
            content: content.into(),
        }
    }
}

fn hash_messages_cache_fingerprint<H: Hasher>(messages: &[SingleSessionMessage], hasher: &mut H) {
    messages.len().hash(hasher);
    if messages.len() <= BODY_CACHE_MESSAGE_EDGE_COUNT * 2 + BODY_CACHE_MESSAGE_MIDDLE_SAMPLE_COUNT
    {
        for message in messages {
            hash_message_cache_fingerprint(message, hasher);
        }
        return;
    }

    for message in &messages[..BODY_CACHE_MESSAGE_EDGE_COUNT] {
        hash_message_cache_fingerprint(message, hasher);
    }
    let middle_start = BODY_CACHE_MESSAGE_EDGE_COUNT;
    let middle_len = messages
        .len()
        .saturating_sub(BODY_CACHE_MESSAGE_EDGE_COUNT * 2);
    for sample in 1..=BODY_CACHE_MESSAGE_MIDDLE_SAMPLE_COUNT {
        let index =
            middle_start + sample * middle_len / (BODY_CACHE_MESSAGE_MIDDLE_SAMPLE_COUNT + 1);
        index.hash(hasher);
        hash_message_cache_fingerprint(&messages[index], hasher);
    }
    for message in &messages[messages.len() - BODY_CACHE_MESSAGE_EDGE_COUNT..] {
        hash_message_cache_fingerprint(message, hasher);
    }
}

fn hash_message_cache_fingerprint<H: Hasher>(message: &SingleSessionMessage, hasher: &mut H) {
    message.role.hash(hasher);
    hash_text_cache_fingerprint(&message.content, hasher);
}

fn hash_text_cache_fingerprint<H: Hasher>(text: &str, hasher: &mut H) {
    let bytes = text.as_bytes();
    bytes.len().hash(hasher);
    if bytes.len() <= BODY_CACHE_TEXT_EDGE_BYTES * 2 {
        bytes.hash(hasher);
        return;
    }

    bytes[..BODY_CACHE_TEXT_EDGE_BYTES].hash(hasher);
    bytes[bytes.len() - BODY_CACHE_TEXT_EDGE_BYTES..].hash(hasher);
}

impl SingleSessionApp {
    pub(crate) fn new(session: Option<workspace::SessionCard>) -> Self {
        let welcome_timeline = session.is_none();
        let welcome_name = desktop_welcome_name();
        let welcome_hero_phrase_index = welcome_phrase_index(&welcome_name);
        Self {
            session,
            draft: String::new(),
            draft_cursor: 0,
            detail_scroll: 0,
            live_session_id: None,
            messages: Vec::new(),
            streaming_response: String::new(),
            status: None,
            error: None,
            is_processing: false,
            body_scroll_lines: 0.0,
            show_help: false,
            show_session_info: false,
            pending_images: Vec::new(),
            model_picker: ModelPickerState::default(),
            session_switcher: SessionSwitcherState::default(),
            stdin_response: None,
            welcome_name,
            recovery_session_count: 0,
            queued_drafts: Vec::new(),
            selection_anchor: None,
            selection_focus: None,
            draft_selection_anchor: None,
            draft_selection_focus: None,
            input_undo_stack: Vec::new(),
            session_handle: None,
            active_tool_message_index: None,
            active_tool_input_buffer: String::new(),
            reload_phase: ReloadPhase::Stable,
            welcome_timeline,
            welcome_hero_phrase_index,
            text_scale: 1.0,
        }
    }

    pub(crate) fn replace_session(&mut self, session: Option<workspace::SessionCard>) {
        let replacing_with_session = session.is_some();
        self.session = session;
        if let Some(session) = &self.session {
            self.live_session_id = Some(session.session_id.clone());
        }
        if replacing_with_session
            && self.messages.is_empty()
            && self.streaming_response.is_empty()
            && self.error.is_none()
        {
            self.welcome_timeline = false;
        } else if !replacing_with_session {
            self.welcome_timeline = true;
        }
        self.detail_scroll = 0;
    }

    pub(crate) fn initialize_resumed_session(&mut self, session_id: &str) {
        self.live_session_id = Some(session_id.to_string());
        self.detail_scroll = 0;
        self.messages.clear();
        self.streaming_response.clear();
        self.error = None;
        self.stdin_response = None;
        self.body_scroll_lines = 0.0;
        self.show_help = false;
        self.show_session_info = false;
        self.is_processing = false;
        self.active_tool_message_index = None;
        self.active_tool_input_buffer.clear();
        self.reload_phase = ReloadPhase::Stable;
        self.welcome_timeline = false;
    }

    pub(crate) fn set_recovery_session_count(&mut self, count: usize) {
        self.recovery_session_count = count;
    }

    pub(crate) fn reset_fresh_session(&mut self) {
        self.session = None;
        self.draft.clear();
        self.draft_cursor = 0;
        self.detail_scroll = 0;
        self.live_session_id = None;
        self.messages.clear();
        self.streaming_response.clear();
        self.status = None;
        self.error = None;
        self.is_processing = false;
        self.body_scroll_lines = 0.0;
        self.show_help = false;
        self.show_session_info = false;
        self.pending_images.clear();
        self.model_picker = ModelPickerState::default();
        self.session_switcher = SessionSwitcherState::default();
        self.stdin_response = None;
        self.welcome_name = desktop_welcome_name();
        self.welcome_hero_phrase_index = welcome_phrase_index(&self.welcome_name);
        self.recovery_session_count = 0;
        self.queued_drafts.clear();
        self.clear_selection();
        self.clear_draft_selection();
        self.input_undo_stack.clear();
        self.session_handle = None;
        self.active_tool_message_index = None;
        self.active_tool_input_buffer.clear();
        self.reload_phase = ReloadPhase::Stable;
        self.welcome_timeline = true;
    }

    pub(crate) fn status_title(&self) -> String {
        let title = self.title();
        format!(
            "Jcode Desktop · single session · {title} · Enter send · Shift+Enter newline · Ctrl+Enter queue · Ctrl+P sessions · Ctrl+Shift+M models · Ctrl+Shift+S info · Ctrl+; spawn · Esc interrupt · --workspace for Niri layout"
        )
    }

    pub(crate) fn title(&self) -> String {
        if let Some(session) = &self.session {
            session.title.clone()
        } else if let Some(session_id) = &self.live_session_id {
            format!("session {}", short_session_id(session_id))
        } else {
            "fresh session".to_string()
        }
    }

    pub(crate) fn header_title(&self) -> String {
        if self.should_show_session_title_header() {
            return self.title();
        }
        String::new()
    }

    pub(crate) fn should_show_session_title_header(&self) -> bool {
        self.messages.is_empty()
            && self.streaming_response.is_empty()
            && self.error.is_none()
            && !self.model_picker.open
            && !self.session_switcher.open
            && self.stdin_response.is_none()
            && self.show_help == false
            && self.show_session_info == false
            && self.session.is_some()
    }

    pub(crate) fn has_background_work(&self) -> bool {
        self.has_activity_indicator()
    }

    pub(crate) fn has_frame_animation(&self) -> bool {
        self.has_activity_indicator()
    }

    fn current_session_id(&self) -> Option<&str> {
        self.live_session_id.as_deref().or_else(|| {
            self.session
                .as_ref()
                .map(|session| session.session_id.as_str())
        })
    }

    pub(crate) fn user_turn_count(&self) -> usize {
        self.messages
            .iter()
            .filter(|message| message.role.is_user())
            .count()
    }

    pub(crate) fn next_prompt_number(&self) -> usize {
        self.user_turn_count() + 1
    }

    pub(crate) fn composer_prompt(&self) -> String {
        format!("{}› ", self.next_prompt_number())
    }

    pub(crate) fn composer_text(&self) -> String {
        format!("{}{}", self.composer_prompt(), self.draft)
    }

    #[cfg(test)]
    pub(crate) fn composer_status_line(&self) -> String {
        self.composer_status_line_for_tick(0)
    }

    #[cfg(test)]
    pub(crate) fn queued_draft_count(&self) -> usize {
        self.queued_drafts.len()
    }

    #[cfg(test)]
    pub(crate) fn queued_draft_messages(&self) -> Vec<String> {
        self.queued_drafts
            .iter()
            .map(|(message, _)| message.clone())
            .collect()
    }

    pub(crate) fn composer_status_line_for_tick(&self, tick: u64) -> String {
        let _ = tick;
        let status = self.status.as_deref().unwrap_or("ready");
        let mode = if self.is_processing {
            "Esc interrupt"
        } else {
            "Enter send · Shift+Enter newline · Ctrl+Enter queue/send"
        };
        let scroll = scroll_status_fragment(self.body_scroll_lines);
        let images = match self.pending_images.len() {
            0 => String::new(),
            1 => " · 1 image".to_string(),
            count => format!(" · {count} images"),
        };
        let queued = match self.queued_drafts.len() {
            0 => String::new(),
            1 => " · 1 queued".to_string(),
            count => format!(" · {count} queued"),
        };
        let stdin = self
            .stdin_response
            .as_ref()
            .map(|state| {
                if state.is_password {
                    " · password input requested".to_string()
                } else {
                    " · interactive input requested".to_string()
                }
            })
            .unwrap_or_default();
        let model = self
            .model_picker
            .current_model
            .as_ref()
            .map(|model| {
                self.model_picker
                    .provider_name
                    .as_deref()
                    .filter(|provider| !provider.is_empty())
                    .map(|provider| format!(" · model {provider}/{model}"))
                    .unwrap_or_else(|| format!(" · model {model}"))
            })
            .unwrap_or_default();
        format!("{status}{images}{queued}{stdin}{model}{scroll} · {mode}")
    }

    #[cfg(test)]
    pub(crate) fn activity_indicator_active(&self) -> bool {
        self.has_activity_indicator()
    }

    pub(crate) fn has_activity_indicator(&self) -> bool {
        self.is_processing
            || self.model_picker.loading
            || self.session_switcher.loading
            || self.status.as_deref().is_some_and(is_in_flight_status)
    }

    pub(crate) fn handle_key(&mut self, key: KeyInput) -> KeyOutcome {
        if self.stdin_response.is_some() {
            return self.handle_stdin_response_key(key);
        }

        if self.session_switcher.open {
            return self.handle_session_switcher_key(key);
        }

        if self.model_picker.open && !self.model_picker.preview {
            return self.handle_model_picker_key(key);
        }

        if self.model_picker.open
            && self.model_picker.preview
            && let Some(outcome) = self.handle_model_picker_preview_key(&key)
        {
            return outcome;
        }

        match key {
            KeyInput::SpawnPanel => KeyOutcome::SpawnSession,
            KeyInput::OpenSessionSwitcher => self.open_session_switcher(),
            KeyInput::OpenModelPicker => self.open_model_picker(),
            KeyInput::HotkeyHelp => {
                self.show_help = !self.show_help;
                if self.show_help {
                    self.show_session_info = false;
                    self.model_picker.close();
                    self.session_switcher.close();
                }
                self.scroll_body_to_bottom();
                KeyOutcome::Redraw
            }
            KeyInput::ToggleSessionInfo => {
                self.show_session_info = !self.show_session_info;
                if self.show_session_info {
                    self.show_help = false;
                    self.model_picker.close();
                    self.session_switcher.close();
                }
                self.scroll_body_to_bottom();
                KeyOutcome::Redraw
            }
            KeyInput::RefreshSessions if self.recovery_session_count > 0 => {
                KeyOutcome::RestoreCrashedSessions
            }
            KeyInput::RefreshSessions => KeyOutcome::Redraw,
            KeyInput::AdjustTextScale(direction) => {
                self.adjust_text_scale(direction);
                KeyOutcome::Redraw
            }
            KeyInput::ResetTextScale => {
                self.text_scale = 1.0;
                KeyOutcome::Redraw
            }
            KeyInput::CancelGeneration => {
                if self.is_processing {
                    KeyOutcome::CancelGeneration
                } else {
                    KeyOutcome::None
                }
            }
            KeyInput::ScrollBodyPages(pages) => {
                self.scroll_body_lines((pages * 12) as f32);
                KeyOutcome::Redraw
            }
            KeyInput::JumpPrompt(direction) => {
                self.jump_prompt(direction);
                KeyOutcome::Redraw
            }
            KeyInput::CopyLatestResponse => self
                .latest_assistant_response()
                .map(KeyOutcome::CopyLatestResponse)
                .unwrap_or(KeyOutcome::None),
            KeyInput::ModelPickerMove(_) => KeyOutcome::None,
            KeyInput::CycleModel(direction) => KeyOutcome::CycleModel(direction),
            KeyInput::AttachClipboardImage => KeyOutcome::AttachClipboardImage,
            KeyInput::ClearAttachedImages => {
                if self.clear_attached_images() {
                    KeyOutcome::Redraw
                } else {
                    KeyOutcome::None
                }
            }
            KeyInput::PasteText => KeyOutcome::PasteText,
            KeyInput::QueueDraft if self.is_processing => self.queue_draft(),
            KeyInput::RetrieveQueuedDraft => self.retrieve_queued_draft_for_edit(),
            KeyInput::QueueDraft => self.submit_draft(),
            KeyInput::SubmitDraft => self.submit_draft(),
            KeyInput::Escape if self.show_help => {
                self.show_help = false;
                KeyOutcome::Redraw
            }
            KeyInput::Escape if self.show_session_info => {
                self.show_session_info = false;
                KeyOutcome::Redraw
            }
            KeyInput::Escape => {
                if self.is_processing {
                    KeyOutcome::CancelGeneration
                } else {
                    KeyOutcome::None
                }
            }
            KeyInput::Enter => {
                self.insert_draft_text("\n");
                KeyOutcome::Redraw
            }
            KeyInput::Backspace => {
                self.delete_previous_char();
                self.sync_model_picker_preview_from_draft()
                    .unwrap_or(KeyOutcome::Redraw)
            }
            KeyInput::DeletePreviousWord => {
                self.delete_previous_word();
                self.sync_model_picker_preview_from_draft()
                    .unwrap_or(KeyOutcome::Redraw)
            }
            KeyInput::DeleteNextWord => {
                self.delete_next_word();
                KeyOutcome::Redraw
            }
            KeyInput::DeleteNextChar => {
                self.delete_next_char();
                KeyOutcome::Redraw
            }
            KeyInput::MoveCursorWordLeft => {
                self.move_cursor_word_left();
                KeyOutcome::Redraw
            }
            KeyInput::MoveCursorWordRight => {
                self.move_cursor_word_right();
                KeyOutcome::Redraw
            }
            KeyInput::MoveCursorLeft => {
                self.move_cursor_left();
                KeyOutcome::Redraw
            }
            KeyInput::MoveCursorRight => {
                self.move_cursor_right();
                KeyOutcome::Redraw
            }
            KeyInput::MoveToLineStart => {
                self.move_to_line_start();
                KeyOutcome::Redraw
            }
            KeyInput::MoveToLineEnd => {
                self.move_to_line_end();
                KeyOutcome::Redraw
            }
            KeyInput::DeleteToLineStart => {
                self.delete_to_line_start();
                self.sync_model_picker_preview_from_draft()
                    .unwrap_or(KeyOutcome::Redraw)
            }
            KeyInput::DeleteToLineEnd => {
                self.delete_to_line_end();
                self.sync_model_picker_preview_from_draft()
                    .unwrap_or(KeyOutcome::Redraw)
            }
            KeyInput::CutInputLine => self.cut_input_line(),
            KeyInput::UndoInput => {
                self.undo_input_change();
                KeyOutcome::Redraw
            }
            KeyInput::Character(text) => {
                self.insert_draft_text(&text);
                self.sync_model_picker_preview_from_draft()
                    .unwrap_or(KeyOutcome::Redraw)
            }
            _ => KeyOutcome::None,
        }
    }

    pub(crate) fn text_scale(&self) -> f32 {
        self.text_scale
    }

    pub(crate) fn has_active_selection(&self) -> bool {
        self.selection_anchor.is_some()
            || self.selection_focus.is_some()
            || self.draft_selection_anchor.is_some()
            || self.draft_selection_focus.is_some()
    }

    fn adjust_text_scale(&mut self, direction: i8) {
        let delta = direction as f32 * SINGLE_SESSION_TEXT_SCALE_STEP;
        self.text_scale = (self.text_scale + delta)
            .clamp(SINGLE_SESSION_MIN_TEXT_SCALE, SINGLE_SESSION_MAX_TEXT_SCALE);
    }

    fn open_model_picker(&mut self) -> KeyOutcome {
        self.show_help = false;
        self.show_session_info = false;
        self.session_switcher.close();
        self.model_picker.open_loading();
        self.status = Some("loading models".to_string());
        self.scroll_body_to_bottom();
        KeyOutcome::LoadModelCatalog
    }

    fn open_model_picker_preview(&mut self, filter: String) -> KeyOutcome {
        self.show_help = false;
        self.show_session_info = false;
        self.session_switcher.close();
        self.model_picker.open_preview_loading(filter);
        self.status = Some("loading models".to_string());
        self.scroll_body_to_bottom();
        KeyOutcome::LoadModelCatalog
    }

    fn sync_model_picker_preview_from_draft(&mut self) -> Option<KeyOutcome> {
        let Some(filter) = model_picker_preview_filter(&self.draft) else {
            if self.model_picker.open && self.model_picker.preview {
                self.model_picker.close();
                return Some(KeyOutcome::Redraw);
            }
            return None;
        };

        if self.model_picker.open && self.model_picker.preview {
            self.model_picker.set_filter(filter);
            Some(KeyOutcome::Redraw)
        } else {
            Some(self.open_model_picker_preview(filter))
        }
    }

    fn handle_model_picker_preview_key(&mut self, key: &KeyInput) -> Option<KeyOutcome> {
        match key {
            KeyInput::Escape => {
                self.model_picker.close();
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                Some(KeyOutcome::Redraw)
            }
            KeyInput::ModelPickerMove(delta) => {
                self.model_picker.move_selection(*delta);
                Some(KeyOutcome::Redraw)
            }
            KeyInput::ScrollBodyPages(pages) => {
                self.model_picker
                    .move_selection(if *pages > 0 { -5 } else { 5 });
                Some(KeyOutcome::Redraw)
            }
            KeyInput::SubmitDraft => {
                let Some(model) = self.model_picker.selected_model() else {
                    self.model_picker.close();
                    self.draft.clear();
                    self.draft_cursor = 0;
                    self.input_undo_stack.clear();
                    return Some(KeyOutcome::Redraw);
                };
                self.model_picker.close();
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                Some(KeyOutcome::SetModel(model))
            }
            KeyInput::RefreshSessions => {
                let filter = self.model_picker.filter.clone();
                self.model_picker.open_preview_loading(filter);
                self.status = Some("loading models".to_string());
                Some(KeyOutcome::LoadModelCatalog)
            }
            _ => None,
        }
    }

    fn open_session_switcher(&mut self) -> KeyOutcome {
        self.show_help = false;
        self.show_session_info = false;
        self.model_picker.close();
        let current_session_id = self.current_session_id().map(str::to_string);
        self.session_switcher
            .open_loading(current_session_id.as_deref());
        self.status = Some("loading recent sessions".to_string());
        self.scroll_body_to_bottom();
        KeyOutcome::LoadSessionSwitcher
    }

    fn handle_model_picker_key(&mut self, key: KeyInput) -> KeyOutcome {
        match key {
            KeyInput::Escape if !self.model_picker.filter.is_empty() => {
                self.model_picker.set_filter(String::new());
                KeyOutcome::Redraw
            }
            KeyInput::Escape | KeyInput::OpenModelPicker => {
                self.model_picker.close();
                KeyOutcome::Redraw
            }
            KeyInput::OpenSessionSwitcher => {
                self.model_picker.close();
                self.open_session_switcher()
            }
            KeyInput::RefreshSessions => {
                self.model_picker.open_loading();
                self.status = Some("loading models".to_string());
                KeyOutcome::LoadModelCatalog
            }
            KeyInput::ModelPickerMove(delta) => {
                self.model_picker.move_selection(delta);
                KeyOutcome::Redraw
            }
            KeyInput::ScrollBodyPages(pages) => {
                self.model_picker
                    .move_selection(if pages > 0 { -5 } else { 5 });
                KeyOutcome::Redraw
            }
            KeyInput::MoveCursorRight => {
                self.model_picker.column = (self.model_picker.column + 1).min(2);
                KeyOutcome::Redraw
            }
            KeyInput::MoveCursorLeft => {
                self.model_picker.column = self.model_picker.column.saturating_sub(1);
                KeyOutcome::Redraw
            }
            KeyInput::CycleModel(direction) => KeyOutcome::CycleModel(direction),
            KeyInput::SubmitDraft => {
                let Some(model) = self.model_picker.selected_model() else {
                    return KeyOutcome::None;
                };
                self.model_picker.close();
                KeyOutcome::SetModel(model)
            }
            KeyInput::Backspace => {
                self.model_picker.pop_filter_char();
                KeyOutcome::Redraw
            }
            KeyInput::Character(text) => {
                self.model_picker.push_filter_text(&text);
                KeyOutcome::Redraw
            }
            KeyInput::HotkeyHelp => {
                self.model_picker.close();
                self.show_help = true;
                KeyOutcome::Redraw
            }
            _ => KeyOutcome::None,
        }
    }

    fn handle_session_switcher_key(&mut self, key: KeyInput) -> KeyOutcome {
        match key {
            KeyInput::Escape | KeyInput::OpenSessionSwitcher => {
                self.session_switcher.close();
                KeyOutcome::Redraw
            }
            KeyInput::RefreshSessions => {
                let current_session_id = self.current_session_id().map(str::to_string);
                self.session_switcher
                    .open_loading(current_session_id.as_deref());
                self.status = Some("loading recent sessions".to_string());
                KeyOutcome::LoadSessionSwitcher
            }
            KeyInput::ModelPickerMove(delta) => {
                self.session_switcher.move_selection(delta);
                KeyOutcome::Redraw
            }
            KeyInput::SubmitDraft => self.resume_selected_switcher_session(),
            KeyInput::Backspace => {
                self.session_switcher.pop_filter_char();
                KeyOutcome::Redraw
            }
            KeyInput::Character(text) => {
                self.session_switcher.push_filter_text(&text);
                KeyOutcome::Redraw
            }
            KeyInput::HotkeyHelp => {
                self.session_switcher.close();
                self.show_help = true;
                KeyOutcome::Redraw
            }
            KeyInput::OpenModelPicker => {
                self.session_switcher.close();
                self.open_model_picker()
            }
            KeyInput::SpawnPanel => {
                self.session_switcher.close();
                KeyOutcome::SpawnSession
            }
            _ => KeyOutcome::None,
        }
    }

    pub(crate) fn apply_session_switcher_cards(&mut self, cards: Vec<workspace::SessionCard>) {
        let current_session_id = self.current_session_id().map(str::to_string);
        self.session_switcher
            .apply_sessions(cards, current_session_id.as_deref());
        if self.session_switcher.open {
            self.status = Some(format!(
                "{} recent session(s)",
                self.session_switcher.sessions.len()
            ));
        }
    }

    fn resume_selected_switcher_session(&mut self) -> KeyOutcome {
        if self.is_processing {
            self.status = Some(
                "finish or Esc interrupt the running generation before switching sessions"
                    .to_string(),
            );
            return KeyOutcome::Redraw;
        }

        let Some(session) = self.session_switcher.selected_session() else {
            return KeyOutcome::None;
        };
        let title = session.title.clone();
        self.session = Some(session);
        self.live_session_id = self
            .session
            .as_ref()
            .map(|session| session.session_id.clone());
        self.detail_scroll = 0;
        self.messages.clear();
        self.streaming_response.clear();
        self.error = None;
        self.stdin_response = None;
        self.body_scroll_lines = 0.0;
        self.show_help = false;
        self.welcome_timeline = false;
        self.session_switcher.close();
        self.status = Some(format!("resumed {title}"));
        KeyOutcome::Redraw
    }

    fn handle_stdin_response_key(&mut self, key: KeyInput) -> KeyOutcome {
        match key {
            KeyInput::SubmitDraft | KeyInput::QueueDraft => {
                let Some(state) = self.stdin_response.take() else {
                    return KeyOutcome::None;
                };
                self.status = Some("sending interactive input".to_string());
                KeyOutcome::SendStdinResponse {
                    request_id: state.request_id,
                    input: state.input,
                }
            }
            KeyInput::Enter => {
                if let Some(state) = &mut self.stdin_response {
                    state.input.push('\n');
                }
                KeyOutcome::Redraw
            }
            KeyInput::Backspace => {
                if let Some(state) = &mut self.stdin_response {
                    state.input.pop();
                }
                KeyOutcome::Redraw
            }
            KeyInput::DeleteToLineStart => {
                if let Some(state) = &mut self.stdin_response {
                    state.input.clear();
                }
                KeyOutcome::Redraw
            }
            KeyInput::PasteText => KeyOutcome::PasteText,
            KeyInput::Character(text) => {
                if let Some(state) = &mut self.stdin_response {
                    state.input.push_str(&text);
                }
                KeyOutcome::Redraw
            }
            KeyInput::CancelGeneration => KeyOutcome::CancelGeneration,
            KeyInput::Escape => {
                self.status = Some("interactive input pending · Esc to cancel".to_string());
                KeyOutcome::Redraw
            }
            _ => KeyOutcome::None,
        }
    }

    pub(crate) fn body_lines(&self) -> Vec<String> {
        self.body_styled_lines()
            .into_iter()
            .map(|line| line.text)
            .collect()
    }

    pub(crate) fn body_styled_lines(&self) -> Vec<SingleSessionStyledLine> {
        if let Some(stdin_response) = &self.stdin_response {
            return stdin_response_styled_lines(stdin_response);
        }
        if self.session_switcher.open {
            return session_switcher_styled_lines(
                &self.session_switcher,
                self.current_session_id(),
            );
        }
        self.body_styled_lines_without_inline_widgets()
    }

    pub(crate) fn inline_widget_styled_lines(&self) -> Vec<SingleSessionStyledLine> {
        if self.show_help {
            return hotkey_help_inline_widget().styled_lines();
        }
        if self.model_picker.open {
            return model_picker_inline_styled_lines(&self.model_picker);
        }
        if self.show_session_info {
            return session_info_inline_styled_lines(self);
        }
        Vec::new()
    }

    pub(crate) fn inline_widget_line_count(&self) -> usize {
        if self.show_help {
            return hotkey_help_inline_widget().styled_lines().len();
        }
        if self.model_picker.open {
            return model_picker_inline_styled_lines(&self.model_picker).len();
        }
        if self.show_session_info {
            return session_info_inline_styled_lines(self).len();
        }
        0
    }

    fn body_styled_lines_without_inline_widgets(&self) -> Vec<SingleSessionStyledLine> {
        if !self.messages.is_empty() || !self.streaming_response.is_empty() || self.error.is_some()
        {
            return self.transcript_styled_lines(true);
        }

        if self.is_welcome_timeline_visible() {
            if let Some(status) = &self.status
                && self.session.is_none()
                && !self.model_picker.open
                && !self.show_session_info
            {
                return vec![styled_line(status.clone(), SingleSessionLineStyle::Status)];
            }
            if self.recovery_session_count > 0 {
                return welcome_recovery_styled_lines(self.recovery_session_count);
            }
            return Vec::new();
        }

        if let Some(status) = &self.status
            && self.session.is_none()
            && !self.model_picker.open
            && !self.show_session_info
        {
            return vec![styled_line(status.clone(), SingleSessionLineStyle::Status)];
        }

        single_session_styled_lines(self.session.as_ref())
    }

    pub(crate) fn body_styled_lines_for_tick(&self, _tick: u64) -> Vec<SingleSessionStyledLine> {
        self.body_styled_lines()
    }

    pub(crate) fn body_styled_lines_without_streaming_response(
        &self,
    ) -> Option<Vec<SingleSessionStyledLine>> {
        if self.stdin_response.is_some()
            || self.session_switcher.open
            || self.model_picker.open
            || self.show_help
            || self.error.is_some()
        {
            return None;
        }
        if self.messages.is_empty() && self.streaming_response.is_empty() {
            return None;
        }
        Some(self.transcript_styled_lines(false))
    }

    pub(crate) fn streaming_response_styled_lines(&self) -> Vec<SingleSessionStyledLine> {
        let mut lines = Vec::new();
        if !self.streaming_response.is_empty() {
            append_streaming_assistant_lines(&mut lines, self.streaming_response.trim_end());
        }
        lines
    }

    fn transcript_styled_lines(
        &self,
        include_streaming_response: bool,
    ) -> Vec<SingleSessionStyledLine> {
        let mut lines = Vec::new();
        let mut user_turn = 1;
        let mut message_index = 0;
        while message_index < self.messages.len() {
            if !lines.is_empty() {
                lines.push(blank_styled_line());
            }
            let message = &self.messages[message_index];
            if message.role == SingleSessionRole::Tool {
                let group_start = message_index;
                while message_index < self.messages.len()
                    && self.messages[message_index].role == SingleSessionRole::Tool
                {
                    message_index += 1;
                }
                let tool_messages = &self.messages[group_start..message_index];
                let group_contains_active_tool = self
                    .active_tool_message_index
                    .is_some_and(|index| (group_start..message_index).contains(&index));
                if tool_messages.len() > 1 && !group_contains_active_tool {
                    append_tool_group_summary(&mut lines, tool_messages);
                } else {
                    for (offset, tool_message) in tool_messages.iter().enumerate() {
                        let is_active_tool = self.active_tool_message_index
                            == Some(group_start.saturating_add(offset));
                        append_chat_message_lines(
                            &mut lines,
                            tool_message,
                            &mut user_turn,
                            is_active_tool,
                        );
                    }
                }
                continue;
            }
            append_chat_message_lines(&mut lines, message, &mut user_turn, false);
            message_index += 1;
        }
        if include_streaming_response && !self.streaming_response.is_empty() {
            if !lines.is_empty() {
                lines.push(blank_styled_line());
            }
            append_streaming_assistant_lines(&mut lines, self.streaming_response.trim_end());
        }
        if let Some(error) = &self.error {
            if !lines.is_empty() {
                lines.push(blank_styled_line());
            }
            lines.push(styled_line(
                format!("error: {error}"),
                SingleSessionLineStyle::Error,
            ));
        }
        lines
    }

    pub(crate) fn rendered_body_cache_key(&self, size: (u32, u32)) -> u64 {
        let mut hasher = DefaultHasher::new();
        size.hash(&mut hasher);
        self.session
            .as_ref()
            .map(|session| {
                (
                    session.session_id.as_str(),
                    session.title.as_str(),
                    session.subtitle.as_str(),
                    session.detail.as_str(),
                    session.preview_lines.as_slice(),
                    session.detail_lines.as_slice(),
                )
            })
            .hash(&mut hasher);
        hash_messages_cache_fingerprint(&self.messages, &mut hasher);
        hash_text_cache_fingerprint(&self.streaming_response, &mut hasher);
        self.status.hash(&mut hasher);
        self.error.hash(&mut hasher);
        self.show_help.hash(&mut hasher);
        self.model_picker.open.hash(&mut hasher);
        self.model_picker.filter.hash(&mut hasher);
        self.model_picker.selected.hash(&mut hasher);
        self.session_switcher.open.hash(&mut hasher);
        self.session_switcher.filter.hash(&mut hasher);
        self.session_switcher.selected.hash(&mut hasher);
        self.stdin_response.hash(&mut hasher);
        self.welcome_name.hash(&mut hasher);
        self.recovery_session_count.hash(&mut hasher);
        self.welcome_timeline.hash(&mut hasher);
        self.welcome_hero_phrase_index.hash(&mut hasher);
        self.text_scale.to_bits().hash(&mut hasher);
        hasher.finish()
    }

    pub(crate) fn rendered_body_static_cache_key(&self, size: (u32, u32)) -> u64 {
        let mut hasher = DefaultHasher::new();
        size.hash(&mut hasher);
        self.session
            .as_ref()
            .map(|session| {
                (
                    session.session_id.as_str(),
                    session.title.as_str(),
                    session.subtitle.as_str(),
                    session.detail.as_str(),
                    session.preview_lines.as_slice(),
                    session.detail_lines.as_slice(),
                )
            })
            .hash(&mut hasher);
        hash_messages_cache_fingerprint(&self.messages, &mut hasher);
        self.status.hash(&mut hasher);
        self.error.hash(&mut hasher);
        self.show_help.hash(&mut hasher);
        self.model_picker.open.hash(&mut hasher);
        self.model_picker.filter.hash(&mut hasher);
        self.model_picker.selected.hash(&mut hasher);
        self.session_switcher.open.hash(&mut hasher);
        self.session_switcher.filter.hash(&mut hasher);
        self.session_switcher.selected.hash(&mut hasher);
        self.stdin_response.hash(&mut hasher);
        self.welcome_name.hash(&mut hasher);
        self.recovery_session_count.hash(&mut hasher);
        self.welcome_timeline.hash(&mut hasher);
        self.welcome_hero_phrase_index.hash(&mut hasher);
        self.text_scale.to_bits().hash(&mut hasher);
        hasher.finish()
    }

    pub(crate) fn welcome_hero_text(&self) -> String {
        handwritten_welcome_phrase(self.welcome_hero_phrase_index).to_string()
    }

    pub(crate) fn is_welcome_timeline_visible(&self) -> bool {
        self.welcome_timeline
            && !self.show_help
            && !self.session_switcher.open
            && self.stdin_response.is_none()
    }

    pub(crate) fn has_welcome_timeline_transcript(&self) -> bool {
        !self.messages.is_empty() || !self.streaming_response.is_empty() || self.error.is_some()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn is_fresh_welcome_visible(&self) -> bool {
        self.session.is_none()
            && self.live_session_id.is_none()
            && self.messages.is_empty()
            && self.streaming_response.is_empty()
            && self.status.is_none()
            && self.error.is_none()
            && self.pending_images.is_empty()
            && !self.show_help
            && !self.model_picker.open
            && !self.session_switcher.open
            && self.stdin_response.is_none()
    }

    pub(crate) fn apply_session_event(&mut self, event: DesktopSessionEvent) {
        match event {
            DesktopSessionEvent::Status(status) => self.status = Some(status),
            DesktopSessionEvent::Reloading { .. } => {
                self.status = Some("server reloading, reconnecting".to_string());
                self.is_processing = true;
                self.reload_phase = ReloadPhase::AwaitingReconnect;
            }
            DesktopSessionEvent::Reloaded { session_id } => {
                self.live_session_id = Some(session_id);
                self.status = Some("server reconnected".to_string());
                self.is_processing = true;
                self.reload_phase = ReloadPhase::Stable;
            }
            DesktopSessionEvent::SessionStarted { session_id } => {
                self.live_session_id = Some(session_id);
                self.status = Some("connected".to_string());
            }
            DesktopSessionEvent::TextDelta(text) => {
                self.reload_phase = ReloadPhase::Stable;
                self.streaming_response.push_str(&text);
                self.status = Some("receiving".to_string());
            }
            DesktopSessionEvent::TextReplace(text) => {
                self.reload_phase = ReloadPhase::Stable;
                self.streaming_response = text;
                self.status = Some("receiving".to_string());
            }
            DesktopSessionEvent::ToolStarted { name } => {
                self.reload_phase = ReloadPhase::Stable;
                self.collapse_active_tool_message();
                self.active_tool_input_buffer.clear();
                self.status = Some(format!("preparing tool {name}"));
                self.messages
                    .push(SingleSessionMessage::tool(format!("▾ {name} preparing")));
                self.active_tool_message_index = Some(self.messages.len().saturating_sub(1));
            }
            DesktopSessionEvent::ToolExecuting { name } => {
                self.reload_phase = ReloadPhase::Stable;
                self.status = Some(format!("using tool {name}"));
                self.replace_active_tool_header(&format!("▾ {name} running"));
            }
            DesktopSessionEvent::ToolInput { delta } => {
                self.reload_phase = ReloadPhase::Stable;
                self.append_active_tool_input(&delta);
            }
            DesktopSessionEvent::ToolFinished {
                name,
                summary,
                is_error,
            } => {
                self.reload_phase = ReloadPhase::Stable;
                self.status = Some(if is_error {
                    format!("tool {name} failed")
                } else {
                    format!("tool {name} done")
                });
                let marker = if is_error { "failed" } else { "done" };
                let line = format!("▾ {name} {marker}: {summary}");
                self.flush_active_tool_input_to_message();
                if let Some(index) = self.active_tool_message_index
                    && let Some(message) = self.messages.get_mut(index)
                    && message.role == SingleSessionRole::Tool
                {
                    message.content =
                        merge_tool_finish_with_existing_context(&message.content, &line);
                } else {
                    self.messages.push(SingleSessionMessage::tool(line));
                    self.active_tool_message_index = Some(self.messages.len().saturating_sub(1));
                }
            }
            DesktopSessionEvent::ModelChanged {
                model,
                provider_name,
                error,
            } => {
                if let Some(error) = error {
                    self.status = Some("model switch failed".to_string());
                    self.model_picker.apply_error(error.clone());
                    self.messages.push(SingleSessionMessage::meta(format!(
                        "model switch failed: {error}"
                    )));
                    return;
                }
                let label = provider_name
                    .as_deref()
                    .filter(|provider| !provider.is_empty())
                    .map(|provider| format!("{provider} · {model}"))
                    .unwrap_or_else(|| model.clone());
                self.model_picker
                    .apply_model_change(model.clone(), provider_name.clone());
                self.status = Some(format!("model: {label}"));
                self.messages.push(SingleSessionMessage::meta(format!(
                    "model switched to {label}"
                )));
            }
            DesktopSessionEvent::ModelCatalog {
                current_model,
                provider_name,
                models,
            } => {
                self.model_picker
                    .apply_catalog(current_model, provider_name, models);
                self.status = Some("models loaded".to_string());
            }
            DesktopSessionEvent::ModelCatalogError { error } => {
                self.model_picker.apply_error(error.clone());
                self.status = Some("model picker error".to_string());
            }
            DesktopSessionEvent::StdinRequest {
                request_id,
                prompt,
                is_password,
                tool_call_id,
            } => {
                self.reload_phase = ReloadPhase::Stable;
                self.status = Some("interactive input requested".to_string());
                self.show_help = false;
                self.model_picker.close();
                let raw_prompt = prompt.trim();
                let display_prompt = if raw_prompt.is_empty() {
                    "interactive input requested"
                } else {
                    raw_prompt
                };
                self.stdin_response = Some(StdinResponseState {
                    request_id: request_id.clone(),
                    prompt: display_prompt.to_string(),
                    is_password,
                    tool_call_id: tool_call_id.clone(),
                    input: String::new(),
                });
                let sensitive = if is_password { " password" } else { "" };
                self.messages.push(SingleSessionMessage::meta(format!(
                    "interactive{sensitive} input requested by {tool_call_id} ({request_id}): {display_prompt}"
                )));
            }
            DesktopSessionEvent::Done => {
                if self.reload_phase == ReloadPhase::AwaitingReconnect {
                    self.status = Some("server reloading, reconnecting".to_string());
                    self.is_processing = true;
                    return;
                }
                self.finish_streaming_response();
                self.is_processing = false;
                self.stdin_response = None;
                self.session_handle = None;
                self.active_tool_message_index = None;
                self.active_tool_input_buffer.clear();
                self.status = Some("ready".to_string());
            }
            DesktopSessionEvent::Error(error) => {
                self.reload_phase = ReloadPhase::Stable;
                self.finish_streaming_response();
                self.is_processing = false;
                self.stdin_response = None;
                self.session_handle = None;
                self.active_tool_message_index = None;
                self.active_tool_input_buffer.clear();
                self.status = Some("error".to_string());
                self.error = Some(error);
            }
        }
    }

    pub(crate) fn set_session_handle(&mut self, handle: DesktopSessionHandle) {
        self.session_handle = Some(handle);
    }

    pub(crate) fn cancel_generation(&mut self) -> bool {
        let Some(handle) = &self.session_handle else {
            return false;
        };
        match handle.cancel() {
            Ok(()) => {
                self.stdin_response = None;
                self.status = Some("cancelling".to_string());
                true
            }
            Err(error) => {
                self.error = Some(format!("{error:#}"));
                self.is_processing = false;
                self.stdin_response = None;
                self.session_handle = None;
                true
            }
        }
    }

    pub(crate) fn scroll_body_lines(&mut self, lines: impl Into<f64>) {
        let lines = lines.into() as f32;
        if !lines.is_finite() || lines.abs() < f32::EPSILON {
            return;
        }
        self.body_scroll_lines = (self.body_scroll_lines + lines).max(0.0);
    }

    pub(crate) fn scroll_body_to_bottom(&mut self) {
        self.body_scroll_lines = 0.0;
    }

    pub(crate) fn latest_assistant_response(&self) -> Option<String> {
        if !self.streaming_response.trim().is_empty() {
            return Some(self.streaming_response.trim().to_string());
        }
        self.messages
            .iter()
            .rev()
            .find(|message| message.role == SingleSessionRole::Assistant)
            .map(|message| message.content.trim().to_string())
            .filter(|message| !message.is_empty())
    }

    pub(crate) fn jump_prompt(&mut self, direction: i32) {
        let lines = self.body_lines();
        let prompt_indices = lines
            .iter()
            .enumerate()
            .filter_map(|(index, line)| is_user_prompt_line(line).then_some(index))
            .collect::<Vec<_>>();
        if prompt_indices.is_empty() {
            return;
        }
        let current_line = lines
            .len()
            .saturating_sub(self.body_scroll_lines.floor().max(0.0) as usize)
            .saturating_sub(1);
        let target = if direction < 0 {
            prompt_indices
                .iter()
                .rev()
                .copied()
                .find(|index| *index < current_line)
                .or_else(|| prompt_indices.first().copied())
        } else {
            let next = prompt_indices
                .iter()
                .copied()
                .find(|index| *index > current_line);
            if next.is_none() {
                self.scroll_body_to_bottom();
                return;
            }
            next
        };
        if let Some(target) = target {
            self.body_scroll_lines = lines.len().saturating_sub(target + 1) as f32;
        }
    }

    pub(crate) fn draft_cursor_line_col(&self) -> (usize, usize) {
        let before_cursor = &self.draft[..self.draft_cursor.min(self.draft.len())];
        let line = before_cursor.chars().filter(|ch| *ch == '\n').count();
        let column = before_cursor
            .rsplit('\n')
            .next()
            .unwrap_or_default()
            .chars()
            .count();
        (line, column)
    }

    pub(crate) fn draft_cursor_line_byte_index(&self) -> (usize, usize) {
        let cursor = self.draft_cursor.min(self.draft.len());
        let line = self.draft[..cursor]
            .chars()
            .filter(|ch| *ch == '\n')
            .count();
        let line_start = line_start(&self.draft, cursor);
        (line, cursor - line_start)
    }

    pub(crate) fn composer_cursor_line_byte_index(&self) -> (usize, usize) {
        let (line, index) = self.draft_cursor_line_byte_index();
        if line == 0 {
            (line, self.composer_prompt().len() + index)
        } else {
            (line, index)
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn set_draft_cursor_line_col(&mut self, target_line: usize, target_col: usize) {
        self.draft_cursor = self.draft_byte_index_for_line_col(target_line, target_col);
        self.clamp_draft_cursor();
        self.clear_selection();
        self.clear_draft_selection();
    }

    fn draft_byte_index_for_line_col(&self, target_line: usize, target_col: usize) -> usize {
        let mut line = 0usize;
        let mut line_start = 0usize;
        for (index, ch) in self.draft.char_indices() {
            if line == target_line {
                break;
            }
            if ch == '\n' {
                line += 1;
                line_start = index + ch.len_utf8();
            }
        }

        if line < target_line {
            return self.draft.len();
        }

        let line_end = line_end(&self.draft, line_start);
        self.draft[line_start..line_end]
            .char_indices()
            .map(|(offset, _)| line_start + offset)
            .chain(std::iter::once(line_end))
            .nth(target_col)
            .unwrap_or(line_end)
    }

    fn submit_draft(&mut self) -> KeyOutcome {
        let message = self.draft.trim().to_string();
        if message.is_empty() && self.pending_images.is_empty() {
            return KeyOutcome::None;
        }
        if self.pending_images.is_empty()
            && let Some(outcome) = self.handle_slash_command(&message)
        {
            return outcome;
        }
        let images = std::mem::take(&mut self.pending_images);
        self.record_user_submit(&message);
        let Some(session) = &self.session else {
            return KeyOutcome::StartFreshSession { message, images };
        };
        let session_id = session.session_id.clone();
        let title = session.title.clone();
        KeyOutcome::SendDraft {
            session_id,
            title,
            message,
            images,
        }
    }

    fn handle_slash_command(&mut self, message: &str) -> Option<KeyOutcome> {
        if !message.starts_with('/') {
            return None;
        }

        let mut parts = message.splitn(2, char::is_whitespace);
        let command = parts.next().unwrap_or_default();
        let args = parts.next().unwrap_or_default().trim();

        let outcome = match command {
            "/help" | "/?" => {
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                self.show_help = true;
                self.status = Some("showing desktop slash commands".to_string());
                self.scroll_body_to_bottom();
                KeyOutcome::Redraw
            }
            "/clear" => {
                self.messages.clear();
                self.streaming_response.clear();
                self.error = None;
                self.is_processing = false;
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                self.status = Some("cleared visible transcript".to_string());
                self.scroll_body_to_bottom();
                KeyOutcome::Redraw
            }
            "/new" => {
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                KeyOutcome::SpawnSession
            }
            "/sessions" | "/session" => {
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                return Some(self.open_session_switcher());
            }
            "/model" | "/models" => {
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                if args.is_empty() {
                    return Some(self.open_model_picker());
                }
                KeyOutcome::SetModel(args.to_string())
            }
            "/copy" => {
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                return Some(
                    self.latest_assistant_response()
                        .map(KeyOutcome::CopyLatestResponse)
                        .unwrap_or_else(|| {
                            self.status = Some("no assistant response to copy".to_string());
                            KeyOutcome::Redraw
                        }),
                );
            }
            "/stop" | "/cancel" => {
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                if self.is_processing {
                    KeyOutcome::CancelGeneration
                } else {
                    self.status = Some("nothing is running".to_string());
                    KeyOutcome::Redraw
                }
            }
            "/status" => {
                self.draft.clear();
                self.draft_cursor = 0;
                self.input_undo_stack.clear();
                self.show_help = false;
                self.show_session_info = true;
                self.status = Some("showing session info".to_string());
                self.scroll_body_to_bottom();
                KeyOutcome::Redraw
            }
            "/quit" | "/exit" => KeyOutcome::Exit,
            _ => {
                self.status = Some(format!(
                    "unknown desktop slash command: {command} · try /help"
                ));
                KeyOutcome::Redraw
            }
        };

        Some(outcome)
    }

    pub(crate) fn attach_image(&mut self, media_type: String, base64_data: String) {
        self.pending_images.push((media_type, base64_data));
        self.status = Some(format!("attached {} image(s)", self.pending_images.len()));
    }

    pub(crate) fn clear_attached_images(&mut self) -> bool {
        if self.pending_images.is_empty() {
            return false;
        }
        self.pending_images.clear();
        self.status = Some("cleared image attachments".to_string());
        true
    }

    pub(crate) fn accepts_clipboard_image_paste(&self) -> bool {
        self.stdin_response.is_none() && !self.model_picker.open && !self.session_switcher.open
    }

    pub(crate) fn paste_text(&mut self, text: &str) {
        if !text.is_empty() {
            if let Some(stdin_response) = &mut self.stdin_response {
                stdin_response.input.push_str(text);
                return;
            }
            self.insert_draft_text(text);
        }
    }

    pub(crate) fn send_stdin_response(
        &mut self,
        request_id: String,
        input: String,
    ) -> anyhow::Result<()> {
        let Some(handle) = &self.session_handle else {
            anyhow::bail!("no active desktop session to receive interactive input");
        };
        handle.send_stdin_response(request_id, input)?;
        self.status = Some("interactive input sent".to_string());
        Ok(())
    }

    fn queue_draft(&mut self) -> KeyOutcome {
        let message = self.draft.trim().to_string();
        if message.is_empty() && self.pending_images.is_empty() {
            return KeyOutcome::None;
        }
        let images = std::mem::take(&mut self.pending_images);
        self.queued_drafts.push((message.clone(), images));
        self.messages.push(SingleSessionMessage::meta(format!(
            "queued prompt: {message}"
        )));
        self.draft.clear();
        self.draft_cursor = 0;
        self.input_undo_stack.clear();
        self.status = Some(format!("{} prompt(s) queued", self.queued_drafts.len()));
        KeyOutcome::Redraw
    }

    fn retrieve_queued_draft_for_edit(&mut self) -> KeyOutcome {
        let Some((message, images)) = self.queued_drafts.pop() else {
            return KeyOutcome::None;
        };
        self.remember_input_undo_state();
        self.draft = message;
        self.draft_cursor = self.draft.len();
        self.pending_images = images;
        self.status = Some(format!("{} prompt(s) queued", self.queued_drafts.len()));
        KeyOutcome::Redraw
    }

    fn cut_input_line(&mut self) -> KeyOutcome {
        if self.draft.is_empty() {
            return KeyOutcome::None;
        }
        self.remember_input_undo_state();
        let text = std::mem::take(&mut self.draft);
        self.draft_cursor = 0;
        self.status = Some("cut input line".to_string());
        KeyOutcome::CutDraftToClipboard(text)
    }

    pub(crate) fn take_next_queued_draft(&mut self) -> Option<(String, Vec<(String, String)>)> {
        if self.is_processing || self.error.is_some() || self.queued_drafts.is_empty() {
            return None;
        }
        let (message, images) = self.queued_drafts.remove(0);
        self.record_user_submit(&message);
        Some((message, images))
    }

    pub(crate) fn begin_selection(&mut self, point: SelectionPoint) {
        self.selection_anchor = Some(point);
        self.selection_focus = Some(point);
    }

    pub(crate) fn update_selection(&mut self, point: SelectionPoint) {
        if self.selection_anchor.is_some() {
            self.selection_focus = Some(point);
        }
    }

    pub(crate) fn clear_selection(&mut self) {
        self.selection_anchor = None;
        self.selection_focus = None;
    }

    pub(crate) fn begin_draft_selection(&mut self, point: SelectionPoint) {
        self.clear_selection();
        self.draft_selection_anchor = Some(point);
        self.draft_selection_focus = Some(point);
        self.draft_cursor = self.draft_byte_index_for_line_col(point.line, point.column);
        self.clamp_draft_cursor();
    }

    pub(crate) fn update_draft_selection(&mut self, point: SelectionPoint) {
        if self.draft_selection_anchor.is_some() {
            self.draft_selection_focus = Some(point);
            self.draft_cursor = self.draft_byte_index_for_line_col(point.line, point.column);
            self.clamp_draft_cursor();
        }
    }

    pub(crate) fn clear_draft_selection(&mut self) {
        self.draft_selection_anchor = None;
        self.draft_selection_focus = None;
    }

    pub(crate) fn draft_selection_points(&self) -> Option<(SelectionPoint, SelectionPoint)> {
        let anchor = self.draft_selection_anchor?;
        let focus = self.draft_selection_focus?;
        if selection_point_cmp(anchor, focus).is_gt() {
            Some((focus, anchor))
        } else {
            Some((anchor, focus))
        }
    }

    pub(crate) fn draft_selection_segments(&self) -> Vec<SelectionLineSegment> {
        let lines: Vec<String> = self.draft.split('\n').map(ToString::to_string).collect();
        let Some((start, end)) = self.draft_selection_points() else {
            return Vec::new();
        };
        if start == end || start.line >= lines.len() {
            return Vec::new();
        }
        let end_line = end.line.min(lines.len().saturating_sub(1));
        let mut segments = Vec::new();
        for line_index in start.line..=end_line {
            let line_len = lines[line_index].chars().count();
            let prompt_columns = if line_index == 0 {
                self.composer_prompt().chars().count()
            } else {
                0
            };
            let start_column = if line_index == start.line {
                start.column.min(line_len)
            } else {
                0
            };
            let end_column = if line_index == end_line {
                end.column.min(line_len)
            } else {
                line_len
            };
            if start_column != end_column || (start.line != end.line && line_len == 0) {
                segments.push(SelectionLineSegment {
                    line: line_index,
                    start_column: start_column + prompt_columns,
                    end_column: end_column + prompt_columns,
                });
            }
        }
        segments
    }

    pub(crate) fn selected_draft_text(&mut self) -> Option<String> {
        let (start, end) = self.draft_selection_points()?;
        if start == end {
            self.clear_draft_selection();
            return None;
        }
        let start_index = self.draft_byte_index_for_line_col(start.line, start.column);
        let end_index = self.draft_byte_index_for_line_col(end.line, end.column);
        let (start_index, end_index) = if start_index <= end_index {
            (start_index, end_index)
        } else {
            (end_index, start_index)
        };
        let selected = self.draft.get(start_index..end_index).map(str::to_string);
        self.clear_draft_selection();
        selected.filter(|text| !text.is_empty())
    }

    fn draft_selection_range(&self) -> Option<(usize, usize)> {
        let (start, end) = self.draft_selection_points()?;
        if start == end {
            return None;
        }
        let start_index = self.draft_byte_index_for_line_col(start.line, start.column);
        let end_index = self.draft_byte_index_for_line_col(end.line, end.column);
        if start_index <= end_index {
            Some((start_index, end_index)).filter(|(start, end)| start != end)
        } else {
            Some((end_index, start_index)).filter(|(start, end)| start != end)
        }
    }

    fn replace_draft_selection_with(&mut self, text: &str) -> bool {
        let Some((start, end)) = self.draft_selection_range() else {
            return false;
        };
        self.remember_input_undo_state();
        self.draft.replace_range(start..end, text);
        self.draft_cursor = start + text.len();
        self.clear_draft_selection();
        true
    }

    fn delete_draft_selection(&mut self) -> bool {
        self.replace_draft_selection_with("")
    }

    pub(crate) fn selection_points(&self) -> Option<(SelectionPoint, SelectionPoint)> {
        let anchor = self.selection_anchor?;
        let focus = self.selection_focus?;
        if selection_point_cmp(anchor, focus).is_gt() {
            Some((focus, anchor))
        } else {
            Some((anchor, focus))
        }
    }

    pub(crate) fn selection_segments(&self, lines: &[String]) -> Vec<SelectionLineSegment> {
        let Some((start, end)) = self.selection_points() else {
            return Vec::new();
        };
        if start == end || start.line >= lines.len() {
            return Vec::new();
        }

        let end_line = end.line.min(lines.len().saturating_sub(1));
        let mut segments = Vec::new();
        for line_index in start.line..=end_line {
            let line_len = lines[line_index].chars().count();
            let start_column = if line_index == start.line {
                start.column.min(line_len)
            } else {
                0
            };
            let end_column = if line_index == end_line {
                end.column.min(line_len)
            } else {
                line_len
            };
            if start_column != end_column || (start.line != end.line && line_len == 0) {
                segments.push(SelectionLineSegment {
                    line: line_index,
                    start_column,
                    end_column,
                });
            }
        }
        segments
    }

    pub(crate) fn has_body_selection(&self) -> bool {
        self.selection_anchor.is_some() && self.selection_focus.is_some()
    }

    pub(crate) fn has_draft_selection(&self) -> bool {
        self.draft_selection_anchor.is_some() && self.draft_selection_focus.is_some()
    }

    pub(crate) fn selected_text_from_lines(&self, lines: &[String]) -> Option<String> {
        let (start, end) = self.selection_points()?;
        if start == end || start.line >= lines.len() {
            return None;
        }
        let end_line = end.line.min(lines.len().saturating_sub(1));
        let mut selected = Vec::new();
        for line_index in start.line..=end_line {
            let line = &lines[line_index];
            let line_len = line.chars().count();
            let start_column = if line_index == start.line {
                start.column.min(line_len)
            } else {
                0
            };
            let end_column = if line_index == end_line {
                end.column.min(line_len)
            } else {
                line_len
            };
            selected.push(slice_by_char_columns(line, start_column, end_column));
        }
        let text = selected.join("\n");
        (!text.is_empty()).then_some(text)
    }

    fn record_user_submit(&mut self, message: &str) {
        self.messages.push(SingleSessionMessage::user(message));
        self.draft.clear();
        self.draft_cursor = 0;
        self.input_undo_stack.clear();
        self.streaming_response.clear();
        self.scroll_body_to_bottom();
        self.status = Some("sending".to_string());
        self.error = None;
        self.is_processing = true;
    }

    fn finish_streaming_response(&mut self) {
        let response = self.streaming_response.trim().to_string();
        if !response.is_empty() {
            self.messages
                .push(SingleSessionMessage::assistant(response));
        }
        self.streaming_response.clear();
    }

    fn collapse_active_tool_message(&mut self) {
        let Some(index) = self.active_tool_message_index.take() else {
            return;
        };
        let Some(message) = self.messages.get_mut(index) else {
            return;
        };
        if message.role != SingleSessionRole::Tool {
            return;
        }
        if let Some(first_line) = message.content.lines().next() {
            message.content = first_line.replacen('▾', "▸", 1);
        }
    }

    fn append_active_tool_input(&mut self, delta: &str) {
        if delta.is_empty() {
            return;
        }
        self.active_tool_input_buffer.push_str(delta);
    }

    fn flush_active_tool_input_to_message(&mut self) {
        if self.active_tool_input_buffer.is_empty() {
            return;
        }
        let Some(index) = self.active_tool_message_index else {
            return;
        };
        let Some(message) = self.messages.get_mut(index) else {
            return;
        };
        if message.role != SingleSessionRole::Tool {
            return;
        }
        if !message.content.contains("\n  input: ") {
            message.content.push_str("\n  input: ");
        }
        message.content.push_str(&self.active_tool_input_buffer);
        self.active_tool_input_buffer.clear();
    }

    fn replace_active_tool_header(&mut self, header: &str) {
        let Some(index) = self.active_tool_message_index else {
            self.messages
                .push(SingleSessionMessage::tool(header.to_string()));
            self.active_tool_message_index = Some(self.messages.len().saturating_sub(1));
            return;
        };
        let Some(message) = self.messages.get_mut(index) else {
            self.messages
                .push(SingleSessionMessage::tool(header.to_string()));
            self.active_tool_message_index = Some(self.messages.len().saturating_sub(1));
            return;
        };
        if message.role == SingleSessionRole::Tool {
            let replacement = merge_tool_finish_with_existing_context(&message.content, header);
            if message.content != replacement {
                message.content = replacement;
            }
        }
    }

    fn insert_draft_text(&mut self, text: &str) {
        if self.replace_draft_selection_with(text) {
            return;
        }
        if !text.is_empty() {
            self.remember_input_undo_state();
        }
        self.clamp_draft_cursor();
        self.draft.insert_str(self.draft_cursor, text);
        self.draft_cursor += text.len();
    }

    fn delete_previous_char(&mut self) {
        if self.delete_draft_selection() {
            return;
        }
        self.clamp_draft_cursor();
        if self.draft_cursor == 0 {
            return;
        }
        self.remember_input_undo_state();
        let previous = previous_char_boundary(&self.draft, self.draft_cursor);
        self.draft.replace_range(previous..self.draft_cursor, "");
        self.draft_cursor = previous;
    }

    fn delete_next_char(&mut self) {
        if self.delete_draft_selection() {
            return;
        }
        self.clamp_draft_cursor();
        if self.draft_cursor >= self.draft.len() {
            return;
        }
        self.remember_input_undo_state();
        let next = next_char_boundary(&self.draft, self.draft_cursor);
        self.draft.replace_range(self.draft_cursor..next, "");
    }

    fn delete_previous_word(&mut self) {
        if self.delete_draft_selection() {
            return;
        }
        self.clamp_draft_cursor();
        let start = previous_word_start(&self.draft, self.draft_cursor);
        if start < self.draft_cursor {
            self.remember_input_undo_state();
        }
        self.draft.replace_range(start..self.draft_cursor, "");
        self.draft_cursor = start;
    }

    fn delete_next_word(&mut self) {
        if self.delete_draft_selection() {
            return;
        }
        self.clamp_draft_cursor();
        let end = next_word_end(&self.draft, self.draft_cursor);
        if end > self.draft_cursor {
            self.remember_input_undo_state();
        }
        self.draft.replace_range(self.draft_cursor..end, "");
    }

    fn move_cursor_left(&mut self) {
        self.clamp_draft_cursor();
        self.draft_cursor = previous_char_boundary(&self.draft, self.draft_cursor);
        self.clear_draft_selection();
    }

    fn move_cursor_right(&mut self) {
        self.clamp_draft_cursor();
        self.draft_cursor = next_char_boundary(&self.draft, self.draft_cursor);
        self.clear_draft_selection();
    }

    fn move_cursor_word_left(&mut self) {
        self.clamp_draft_cursor();
        self.draft_cursor = previous_word_start(&self.draft, self.draft_cursor);
        self.clear_draft_selection();
    }

    fn move_cursor_word_right(&mut self) {
        self.clamp_draft_cursor();
        self.draft_cursor = next_word_end(&self.draft, self.draft_cursor);
        self.clear_draft_selection();
    }

    fn move_to_line_start(&mut self) {
        self.clamp_draft_cursor();
        self.draft_cursor = line_start(&self.draft, self.draft_cursor);
        self.clear_draft_selection();
    }

    fn move_to_line_end(&mut self) {
        self.clamp_draft_cursor();
        self.draft_cursor = line_end(&self.draft, self.draft_cursor);
        self.clear_draft_selection();
    }

    fn delete_to_line_start(&mut self) {
        if self.delete_draft_selection() {
            return;
        }
        self.clamp_draft_cursor();
        let start = line_start(&self.draft, self.draft_cursor);
        if start < self.draft_cursor {
            self.remember_input_undo_state();
        }
        self.draft.replace_range(start..self.draft_cursor, "");
        self.draft_cursor = start;
    }

    fn delete_to_line_end(&mut self) {
        if self.delete_draft_selection() {
            return;
        }
        self.clamp_draft_cursor();
        let end = line_end(&self.draft, self.draft_cursor);
        if end > self.draft_cursor {
            self.remember_input_undo_state();
        }
        self.draft.replace_range(self.draft_cursor..end, "");
    }

    fn remember_input_undo_state(&mut self) {
        if self
            .input_undo_stack
            .last()
            .is_some_and(|(draft, cursor)| draft == &self.draft && *cursor == self.draft_cursor)
        {
            return;
        }
        self.input_undo_stack
            .push((self.draft.clone(), self.draft_cursor));
        const MAX_UNDO: usize = 64;
        if self.input_undo_stack.len() > MAX_UNDO {
            self.input_undo_stack.remove(0);
        }
    }

    fn undo_input_change(&mut self) {
        if let Some((draft, cursor)) = self.input_undo_stack.pop() {
            self.draft = draft;
            self.draft_cursor = cursor.min(self.draft.len());
            self.clamp_draft_cursor();
            self.clear_draft_selection();
        }
    }

    fn clamp_draft_cursor(&mut self) {
        self.draft_cursor = self.draft_cursor.min(self.draft.len());
        while !self.draft.is_char_boundary(self.draft_cursor) {
            self.draft_cursor -= 1;
        }
    }
}

fn styled_line(text: impl Into<String>, style: SingleSessionLineStyle) -> SingleSessionStyledLine {
    SingleSessionStyledLine::new(text, style)
}

fn is_in_flight_status(status: &str) -> bool {
    matches!(
        status,
        "loading models"
            | "loading recent sessions"
            | "receiving"
            | "connected"
            | "sending interactive input"
            | "switching model"
            | "cancelling"
    ) || status.starts_with("using tool ")
        || status.starts_with("preparing tool ")
        || status.starts_with("attached ")
}

fn scroll_status_fragment(scroll_lines: f32) -> String {
    if !scroll_lines.is_finite() || scroll_lines < 0.05 {
        return String::new();
    }
    if (scroll_lines - 1.0).abs() < 0.05 {
        return " · scrolled up 1 line".to_string();
    }
    let rounded = (scroll_lines * 10.0).round() / 10.0;
    if (rounded - rounded.round()).abs() < 0.05 {
        format!(" · scrolled up {} lines", rounded.round() as usize)
    } else {
        format!(" · scrolled up {rounded:.1} lines")
    }
}

fn blank_styled_line() -> SingleSessionStyledLine {
    styled_line(String::new(), SingleSessionLineStyle::Blank)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn welcome_styled_lines(
    name: &Option<String>,
    tick: u64,
    recovery_session_count: usize,
) -> Vec<SingleSessionStyledLine> {
    let greeting = welcome_greeting_text(name, 0);
    let prompts = [
        "Start with a prompt",
        "Ask anything",
        "Ready when you are",
        "Enter sends · Shift+Enter adds a line",
    ];
    let prompt = prompts[((tick / 42) as usize) % prompts.len()];
    let ellipsis = match (tick / 14) % 4 {
        0 => "",
        1 => ".",
        2 => "..",
        _ => "...",
    };

    let mut lines = vec![
        styled_line(greeting, SingleSessionLineStyle::AssistantHeading),
        blank_styled_line(),
        styled_line(
            format!("{prompt}{ellipsis}"),
            SingleSessionLineStyle::Status,
        ),
        styled_line("Ctrl+P opens recent sessions", SingleSessionLineStyle::Meta),
    ];

    if recovery_session_count > 0 {
        lines.push(blank_styled_line());
        lines.push(styled_line(
            format!(
                "Found {recovery_session_count} crashed session(s). Press Ctrl+R to open them in new windows."
            ),
            SingleSessionLineStyle::Status,
        ));
    }

    lines
}

fn welcome_recovery_styled_lines(recovery_session_count: usize) -> Vec<SingleSessionStyledLine> {
    vec![styled_line(
        format!(
            "Found {recovery_session_count} crashed session(s). Press Ctrl+R to open them in new windows."
        ),
        SingleSessionLineStyle::Status,
    )]
}

fn welcome_greeting_text(name: &Option<String>, phrase_index: usize) -> String {
    name.as_deref()
        .map(|name| format!("Welcome, {name}"))
        .unwrap_or_else(|| handwritten_welcome_phrase(phrase_index).to_string())
}

pub(crate) fn handwritten_welcome_phrase(index: usize) -> &'static str {
    HANDWRITTEN_WELCOME_PHRASES[index % HANDWRITTEN_WELCOME_PHRASES.len()]
}

fn welcome_phrase_index(name: &Option<String>) -> usize {
    let time_seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos() as usize)
        .unwrap_or(0);
    let name_seed = name
        .as_deref()
        .unwrap_or_default()
        .bytes()
        .fold(0usize, |hash, byte| {
            hash.wrapping_mul(31).wrapping_add(byte as usize)
        });
    (time_seed ^ name_seed) % HANDWRITTEN_WELCOME_PHRASES.len()
}

#[cfg(any(target_os = "macos", windows))]
fn desktop_welcome_name() -> Option<String> {
    sanitize_welcome_name(&whoami::realname())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn desktop_welcome_name() -> Option<String> {
    None
}

#[cfg_attr(not(any(test, target_os = "macos", windows)), allow(dead_code))]
pub(crate) fn sanitize_welcome_name(raw: &str) -> Option<String> {
    let name = raw
        .trim()
        .trim_matches(|ch: char| ch == ',' || ch == ';')
        .split_whitespace()
        .next()?;
    if name.is_empty() || name.eq_ignore_ascii_case("unknown") {
        return None;
    }
    Some(name.to_string())
}

fn stdin_response_styled_lines(state: &StdinResponseState) -> Vec<SingleSessionStyledLine> {
    let kind = if state.is_password {
        "interactive password input"
    } else {
        "interactive input"
    };
    let input = if state.is_password {
        "•".repeat(state.input.chars().count())
    } else if state.input.is_empty() {
        "<empty>".to_string()
    } else {
        state.input.replace(' ', "·")
    };
    vec![
        styled_line(
            format!("{kind} requested"),
            SingleSessionLineStyle::OverlayTitle,
        ),
        styled_line(
            format!("tool: {}", state.tool_call_id),
            SingleSessionLineStyle::Tool,
        ),
        styled_line(
            format!("request: {}", state.request_id),
            SingleSessionLineStyle::Meta,
        ),
        styled_line(
            format!("prompt: {}", state.prompt),
            SingleSessionLineStyle::Meta,
        ),
        blank_styled_line(),
        styled_line(
            format!("input: {input}"),
            SingleSessionLineStyle::OverlaySelection,
        ),
        blank_styled_line(),
        styled_line(
            "Enter send · Ctrl+Enter send · Shift+Enter newline · Ctrl+V paste · Ctrl+U clear · Esc cancel",
            SingleSessionLineStyle::Overlay,
        ),
    ]
}

fn selection_point_cmp(left: SelectionPoint, right: SelectionPoint) -> std::cmp::Ordering {
    left.line
        .cmp(&right.line)
        .then_with(|| left.column.cmp(&right.column))
}

fn slice_by_char_columns(line: &str, start_column: usize, end_column: usize) -> String {
    let start = byte_index_at_char_column(line, start_column);
    let end = byte_index_at_char_column(line, end_column.max(start_column));
    line.get(start..end).unwrap_or_default().to_string()
}

fn byte_index_at_char_column(line: &str, column: usize) -> usize {
    line.char_indices()
        .map(|(index, _)| index)
        .chain(std::iter::once(line.len()))
        .nth(column)
        .unwrap_or(line.len())
}

fn session_switcher_styled_lines(
    switcher: &SessionSwitcherState,
    current_session_id: Option<&str>,
) -> Vec<SingleSessionStyledLine> {
    let mut lines = vec![
        styled_line(
            "desktop session switcher",
            SingleSessionLineStyle::OverlayTitle,
        ),
        styled_line(
            "↑/↓ select · type filter · Backspace edit filter · Enter resume · Ctrl+R reload · Ctrl+P/Esc close",
            SingleSessionLineStyle::Overlay,
        ),
        styled_line(
            format!(
                "filter: {}",
                if switcher.filter.is_empty() {
                    "<none>"
                } else {
                    switcher.filter.as_str()
                }
            ),
            SingleSessionLineStyle::Meta,
        ),
        blank_styled_line(),
    ];

    if switcher.loading {
        lines.push(styled_line(
            "loading recent sessions from ~/.jcode/sessions...",
            SingleSessionLineStyle::Status,
        ));
    }

    let visible = switcher.filtered_indices();
    if visible.is_empty() && !switcher.loading {
        let message = if switcher.sessions.is_empty() {
            "no recent sessions found"
        } else {
            "no matching sessions"
        };
        lines.push(styled_line(message, SingleSessionLineStyle::Status));
        lines.push(styled_line(
            "try clearing the filter, pressing Ctrl+R, or starting a fresh session with Ctrl+;",
            SingleSessionLineStyle::Overlay,
        ));
        return lines;
    }

    let limit = 28;
    for (position, index) in visible.iter().take(limit).enumerate() {
        let Some(session) = switcher.sessions.get(*index) else {
            continue;
        };
        let selector = if position == switcher.selected {
            "›"
        } else {
            " "
        };
        let current_marker = if Some(session.session_id.as_str()) == current_session_id {
            "✓"
        } else {
            " "
        };
        lines.push(styled_line(
            format!(
                "{selector} {current_marker} {}",
                session_card_display_line(session)
            ),
            if position == switcher.selected {
                SingleSessionLineStyle::OverlaySelection
            } else {
                SingleSessionLineStyle::Overlay
            },
        ));
    }
    if visible.len() > limit {
        lines.push(styled_line(
            format!("… {} more sessions", visible.len() - limit),
            SingleSessionLineStyle::Overlay,
        ));
    }

    lines
}

fn session_card_display_line(session: &workspace::SessionCard) -> String {
    let subtitle = if session.subtitle.is_empty() {
        String::new()
    } else {
        format!(" · {}", session.subtitle)
    };
    let detail = if session.detail.is_empty() {
        String::new()
    } else {
        format!(" · {}", session.detail)
    };
    format!("{}{}{}", session.title, subtitle, detail)
}

fn session_card_search_text(session: &workspace::SessionCard) -> String {
    let mut text = format!(
        "{} {} {} {}",
        session.session_id, session.title, session.subtitle, session.detail
    );
    for line in session
        .preview_lines
        .iter()
        .chain(session.detail_lines.iter())
    {
        text.push(' ');
        text.push_str(line);
    }
    text.to_lowercase()
}

fn session_info_inline_styled_lines(app: &SingleSessionApp) -> Vec<SingleSessionStyledLine> {
    let (user_count, assistant_count, tool_count, system_count, meta_count) =
        session_message_role_counts(&app.messages);
    let session_id = app
        .current_session_id()
        .map(|id| format!("{} ({})", short_session_id(id), id))
        .unwrap_or_else(|| "fresh / not started".to_string());
    let model = model_picker_current_label(
        app.model_picker.provider_name.as_deref(),
        app.model_picker.current_model.as_deref(),
    );
    let status = app.status.as_deref().unwrap_or("ready");
    let transcript_chars: usize = app
        .messages
        .iter()
        .map(|message| message.content.len())
        .sum();
    let streaming_chars = app.streaming_response.len();
    let streaming_lines = app.streaming_response.lines().count();
    let body_lines = app.body_styled_lines_without_inline_widgets().len();
    let selection = if app.has_body_selection() || app.has_draft_selection() {
        "active"
    } else {
        "none"
    };
    let stdin = app
        .stdin_response
        .as_ref()
        .map(|state| {
            if state.is_password {
                "password requested"
            } else {
                "input requested"
            }
        })
        .unwrap_or("none");
    let active_tool = app
        .active_tool_message_index
        .map(|index| format!("message #{index}"))
        .unwrap_or_else(|| "none".to_string());

    let mut lines = vec![
        styled_line(
            "╭─ session info · Ctrl+Shift+S/Esc close",
            SingleSessionLineStyle::OverlayTitle,
        ),
        styled_line(
            format!("│ title        {}", compact_tool_text(&app.title(), 92)),
            SingleSessionLineStyle::Overlay,
        ),
        styled_line(
            format!("│ session id   {}", compact_tool_text(&session_id, 92)),
            SingleSessionLineStyle::Overlay,
        ),
        styled_line(
            format!("│ status       {}", compact_tool_text(status, 92)),
            SingleSessionLineStyle::Status,
        ),
        styled_line(
            format!("│ model        {}", compact_tool_text(&model, 92)),
            SingleSessionLineStyle::Overlay,
        ),
        styled_line(
            format!(
                "│ work         {} · worker {} · active tool {}",
                if app.is_processing { "running" } else { "idle" },
                if app.session_handle.is_some() {
                    "attached"
                } else {
                    "none"
                },
                active_tool
            ),
            SingleSessionLineStyle::Overlay,
        ),
        styled_line(
            format!(
                "│ messages     {} total · {user_count} user · {assistant_count} assistant · {tool_count} tool · {system_count} system · {meta_count} meta",
                app.messages.len()
            ),
            SingleSessionLineStyle::Overlay,
        ),
        styled_line(
            format!(
                "│ transcript   {body_lines} visible lines · {transcript_chars} chars · streaming {streaming_chars} chars/{streaming_lines} lines"
            ),
            SingleSessionLineStyle::Overlay,
        ),
        styled_line(
            format!(
                "│ composer     prompt #{} · draft {} chars · {} image(s) · {} queued · stdin {}",
                app.next_prompt_number(),
                app.draft.len(),
                app.pending_images.len(),
                app.queued_drafts.len(),
                stdin
            ),
            SingleSessionLineStyle::Overlay,
        ),
        styled_line(
            format!(
                "│ viewport     scroll {} · text scale {:.0}% · selection {} · welcome {}",
                scroll_status_fragment(app.body_scroll_lines).trim_start_matches(" · "),
                app.text_scale * 100.0,
                selection,
                if app.is_welcome_timeline_visible() {
                    "visible"
                } else {
                    "hidden"
                }
            ),
            SingleSessionLineStyle::Overlay,
        ),
        styled_line(
            "│ tokens       not yet emitted by desktop stream; showing local transcript stats instead",
            SingleSessionLineStyle::Meta,
        ),
    ];

    if let Some(session) = &app.session {
        if !session.subtitle.trim().is_empty() {
            lines.push(styled_line(
                format!(
                    "│ subtitle     {}",
                    compact_tool_text(&session.subtitle, 92)
                ),
                SingleSessionLineStyle::Meta,
            ));
        }
        if !session.detail.trim().is_empty() {
            lines.push(styled_line(
                format!("│ detail       {}", compact_tool_text(&session.detail, 92)),
                SingleSessionLineStyle::Meta,
            ));
        }
    }

    if let Some(error) = &app.error {
        lines.push(styled_line(
            format!("│ error        {}", compact_tool_text(error, 92)),
            SingleSessionLineStyle::Error,
        ));
    }

    lines.push(styled_line(
        "╰─ /status opens this panel",
        SingleSessionLineStyle::Overlay,
    ));
    lines
}

fn session_message_role_counts(
    messages: &[SingleSessionMessage],
) -> (usize, usize, usize, usize, usize) {
    let mut user = 0;
    let mut assistant = 0;
    let mut tool = 0;
    let mut system = 0;
    let mut meta = 0;
    for message in messages {
        match message.role {
            SingleSessionRole::User => user += 1,
            SingleSessionRole::Assistant => assistant += 1,
            SingleSessionRole::Tool => tool += 1,
            SingleSessionRole::System => system += 1,
            SingleSessionRole::Meta => meta += 1,
        }
    }
    (user, assistant, tool, system, meta)
}

fn model_picker_inline_styled_lines(picker: &ModelPickerState) -> Vec<SingleSessionStyledLine> {
    let (active_hint, default_hint) = if picker.preview {
        ("↵ open", "")
    } else {
        ("↑↓ ←→ ↵ Esc", "  ^D=default")
    };
    let filter = (!picker.filter.is_empty()).then(|| format!("  \"{}\"", picker.filter));
    let visible = picker.filtered_indices();
    let count = if visible.len() == picker.choices.len() {
        format!(" ({})", picker.choices.len())
    } else {
        format!(" ({}/{})", visible.len(), picker.choices.len())
    };
    let mut lines = vec![
        styled_line(
            format!(
                "╭─ model picker · current {}",
                model_picker_current_label(
                    picker.provider_name.as_deref(),
                    picker.current_model.as_deref(),
                )
            ),
            SingleSessionLineStyle::OverlayTitle,
        ),
        styled_line(
            format!(
                "│ {:<32} {:<18} {:<12}{}{}  {}{}",
                "MODEL",
                "PROVIDER",
                "METHOD",
                filter.unwrap_or_default(),
                count,
                active_hint,
                default_hint,
            ),
            SingleSessionLineStyle::Overlay,
        ),
    ];

    if picker.loading {
        lines.push(styled_line(
            "│ loading models from shared server...",
            SingleSessionLineStyle::Status,
        ));
    }

    if let Some(error) = &picker.error {
        lines.push(styled_line(
            format!("│ error: {error}"),
            SingleSessionLineStyle::Error,
        ));
    }

    if visible.is_empty() && !picker.loading {
        lines.push(styled_line(
            "│ no matching models",
            SingleSessionLineStyle::Status,
        ));
        lines.push(styled_line(
            "╰─ clear the filter or press Ctrl+R to reload",
            SingleSessionLineStyle::Overlay,
        ));
        return lines;
    }

    let current = picker.current_model.as_deref();
    let limit = 8;
    for (position, index) in visible.iter().take(limit).enumerate() {
        let Some(choice) = picker.choices.get(*index) else {
            continue;
        };
        let selector = if position == picker.selected {
            "›"
        } else {
            " "
        };
        let current_marker = if Some(choice.model.as_str()) == current {
            "✓"
        } else {
            " "
        };
        let provider = choice.provider.as_deref().unwrap_or("auto");
        let method = choice.api_method.as_deref().unwrap_or("auto");
        lines.push(styled_line(
            format!(
                "│ {selector} {current_marker} {:<32} {:<18} {:<12}{}{}",
                truncate_chars(&choice.model, 32),
                truncate_chars(provider, 18),
                truncate_chars(method, 12),
                if choice.available { "" } else { " ×" },
                choice
                    .detail
                    .as_deref()
                    .filter(|detail| !detail.is_empty())
                    .map(|detail| format!("  {detail}"))
                    .unwrap_or_default(),
            ),
            if position == picker.selected {
                SingleSessionLineStyle::OverlaySelection
            } else {
                SingleSessionLineStyle::Overlay
            },
        ));
    }
    if visible.len() > limit {
        lines.push(styled_line(
            format!("│ … {} more models", visible.len() - limit),
            SingleSessionLineStyle::Overlay,
        ));
    }
    lines.push(styled_line("╰─", SingleSessionLineStyle::Overlay));

    lines
}

fn model_picker_preview_filter(input: &str) -> Option<String> {
    let trimmed = input.trim_start();
    let rest = trimmed
        .strip_prefix("/model")
        .or_else(|| trimmed.strip_prefix("/models"))?;
    if rest.is_empty() {
        return Some(String::new());
    }
    rest.chars()
        .next()
        .filter(|ch| ch.is_whitespace())
        .map(|_| rest.trim_start().to_string())
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    if max_chars == 0 {
        return String::new();
    }
    if max_chars == 1 {
        return "…".to_string();
    }
    format!("{}…", text.chars().take(max_chars - 1).collect::<String>())
}

fn model_picker_current_label(provider_name: Option<&str>, current_model: Option<&str>) -> String {
    match (provider_name, current_model) {
        (Some(provider), Some(model)) if !provider.is_empty() => format!("{provider} · {model}"),
        (_, Some(model)) => model.to_string(),
        (Some(provider), None) if !provider.is_empty() => provider.to_string(),
        _ => "unknown".to_string(),
    }
}

fn model_choice_search_text(choice: &DesktopModelChoice) -> String {
    format!(
        "{} {} {} {}",
        choice.model,
        choice.provider.as_deref().unwrap_or_default(),
        choice.api_method.as_deref().unwrap_or_default(),
        choice.detail.as_deref().unwrap_or_default()
    )
    .to_lowercase()
}

fn dedupe_model_choices(choices: Vec<DesktopModelChoice>) -> Vec<DesktopModelChoice> {
    let mut deduped: Vec<DesktopModelChoice> = Vec::new();
    for choice in choices {
        if deduped.iter().any(|existing| {
            existing.model == choice.model
                && existing.provider == choice.provider
                && existing.api_method == choice.api_method
                && existing.detail == choice.detail
        }) {
            continue;
        }
        deduped.push(choice);
    }
    deduped
}

struct HelpSection {
    title: &'static str,
    shortcuts: &'static [(&'static str, &'static str)],
}

const SINGLE_SESSION_HELP_SECTIONS: &[HelpSection] = &[
    HelpSection {
        title: "chat",
        shortcuts: &[
            ("Enter", "send prompt"),
            ("Shift+Enter", "insert newline"),
            ("Ctrl+Enter", "queue while running, send when idle"),
            ("Esc", "interrupt running generation"),
            ("Ctrl+C/D", "interrupt running generation"),
            ("Ctrl+Shift+C", "copy latest assistant response"),
            ("Ctrl+V", "paste clipboard text"),
            ("Ctrl+V", "paste clipboard image when no text is present"),
            ("Alt+V", "attach clipboard image, terminal-style"),
            ("Ctrl+I", "attach clipboard image to next prompt"),
            ("Ctrl+Shift+I", "clear pending image attachments"),
            ("Ctrl+Shift+M", "open model/account picker"),
            ("Ctrl+M/N", "switch to next/previous model"),
            ("Ctrl+P/O", "open recent session switcher"),
            ("Ctrl+Shift+S", "toggle inline session info/stats"),
        ],
    },
    HelpSection {
        title: "navigation",
        shortcuts: &[
            ("Ctrl+Up", "pull latest queued prompt back into the input"),
            ("PageUp/PageDown", "scroll transcript"),
            ("Alt+Up/Down", "jump between user prompts"),
            ("Mouse wheel", "scroll transcript"),
        ],
    },
    HelpSection {
        title: "editing",
        shortcuts: &[
            ("Ctrl+A/E", "start/end of line"),
            ("Ctrl+U/K", "delete to line start/end"),
            ("Ctrl+W/Ctrl+Backspace", "delete previous word"),
            ("Alt+Backspace", "delete previous word, terminal-style"),
            ("Ctrl/Alt+←/→, Ctrl+B/F", "move by word"),
            ("Alt+B/F", "move by word, terminal-style"),
            ("Alt+D", "delete next word"),
            ("Ctrl+X", "cut input line to clipboard"),
            ("Ctrl+Z", "undo input edit"),
        ],
    },
    HelpSection {
        title: "window",
        shortcuts: &[
            ("Ctrl+;", "reset/spawn fresh desktop session"),
            ("Ctrl+R", "reload sessions/models while a picker is open"),
            ("Ctrl+?", "toggle this help"),
            ("Esc", "close help; interrupt while running; idle no-op"),
        ],
    },
];

fn single_session_help_styled_lines() -> Vec<SingleSessionStyledLine> {
    let mut lines = Vec::new();

    lines.push(styled_line(
        "slash commands",
        SingleSessionLineStyle::OverlayTitle,
    ));
    lines.extend(DESKTOP_SLASH_COMMANDS.iter().map(|(command, description)| {
        let separator = if command.len() >= 16 { " " } else { "" };
        styled_line(
            format!("  {command:<16}{separator}{description}"),
            SingleSessionLineStyle::Overlay,
        )
    }));

    for (section_index, section) in SINGLE_SESSION_HELP_SECTIONS.iter().enumerate() {
        let _ = section_index;
        lines.push(blank_styled_line());
        lines.push(styled_line(
            section.title,
            SingleSessionLineStyle::OverlayTitle,
        ));
        lines.extend(section.shortcuts.iter().map(|(shortcut, description)| {
            let separator = if shortcut.len() >= 12 { " " } else { "" };
            styled_line(
                format!("  {shortcut:<12}{separator}{description}"),
                SingleSessionLineStyle::Overlay,
            )
        }));
    }

    lines
}

fn hotkey_help_inline_widget() -> ReadOnlyInlineWidget {
    ReadOnlyInlineWidget::new("desktop shortcuts", single_session_help_styled_lines())
}

fn append_chat_message_lines(
    lines: &mut Vec<SingleSessionStyledLine>,
    message: &SingleSessionMessage,
    user_turn: &mut usize,
    is_active_tool: bool,
) {
    match message.role {
        SingleSessionRole::User => {
            append_user_lines(lines, *user_turn, message.content.trim());
            *user_turn += 1;
        }
        SingleSessionRole::Assistant => append_assistant_lines(lines, message.content.trim()),
        SingleSessionRole::Tool => append_tool_lines(lines, message.content.trim(), is_active_tool),
        SingleSessionRole::System | SingleSessionRole::Meta => {
            append_meta_lines(lines, message.content.trim())
        }
    }
}

fn append_user_lines(lines: &mut Vec<SingleSessionStyledLine>, turn: usize, content: &str) {
    let mut content_lines = content.lines();
    let Some(first) = content_lines.next() else {
        return;
    };
    lines.push(styled_line(
        format!("{turn}  {first}"),
        SingleSessionLineStyle::User,
    ));
    for line in content_lines {
        lines.push(styled_line(
            format!("   {line}"),
            SingleSessionLineStyle::UserContinuation,
        ));
    }
}

fn is_user_prompt_line(line: &str) -> bool {
    let Some((number, rest)) = line.split_once("  ") else {
        return false;
    };
    !number.is_empty() && number.chars().all(|ch| ch.is_ascii_digit()) && !rest.trim().is_empty()
}

fn append_assistant_lines(lines: &mut Vec<SingleSessionStyledLine>, content: &str) {
    lines.extend(render_assistant_markdown_lines(content));
}

fn append_streaming_assistant_lines(lines: &mut Vec<SingleSessionStyledLine>, content: &str) {
    lines.extend(render_assistant_markdown_lines(content));
}

fn render_assistant_markdown_lines(content: &str) -> Vec<SingleSessionStyledLine> {
    let markdown_options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES;
    let mut renderer = AssistantMarkdownRenderer::default();

    for event in Parser::new_ext(content, markdown_options) {
        renderer.handle_event(event);
    }

    let mut lines = renderer.finish();
    if lines.is_empty() && !content.trim().is_empty() {
        lines.extend(
            content
                .lines()
                .map(|line| styled_line(line, SingleSessionLineStyle::Assistant)),
        );
    }
    lines
}

#[derive(Default)]
struct AssistantMarkdownRenderer {
    lines: Vec<SingleSessionStyledLine>,
    current: String,
    current_style: SingleSessionLineStyle,
    line_style_override: Option<SingleSessionLineStyle>,
    quote_depth: usize,
    list_stack: Vec<AssistantMarkdownList>,
    item_continuation_prefixes: Vec<String>,
    pending_line_prefix: String,
    continuation_prefix: String,
    in_code_block: bool,
    table: Option<AssistantMarkdownTable>,
    image_stack: Vec<AssistantMarkdownImage>,
    link_stack: Vec<AssistantMarkdownLink>,
}

#[derive(Clone, Debug)]
struct AssistantMarkdownList {
    next_number: Option<u64>,
}

#[derive(Clone, Debug)]
struct AssistantMarkdownLink {
    dest_url: String,
    start_byte: usize,
}

#[derive(Clone, Debug, Default)]
struct AssistantMarkdownImage {
    dest_url: String,
    alt_text: String,
}

#[derive(Clone, Debug, Default)]
struct AssistantMarkdownTable {
    rows: Vec<Vec<String>>,
    current_row: Vec<String>,
    current_cell: String,
    header_rows: usize,
}

impl Default for SingleSessionLineStyle {
    fn default() -> Self {
        Self::Assistant
    }
}

impl AssistantMarkdownRenderer {
    fn handle_event(&mut self, event: Event<'_>) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => self.start_heading(level),
            Event::End(TagEnd::Heading(_)) => self.end_heading(),
            Event::Start(Tag::Paragraph) => self.start_paragraph(),
            Event::End(TagEnd::Paragraph) => self.end_paragraph(),
            Event::Start(Tag::BlockQuote(_)) => self.start_block_quote(),
            Event::End(TagEnd::BlockQuote(_)) => self.end_block_quote(),
            Event::Start(Tag::List(start)) => self.start_list(start),
            Event::End(TagEnd::List(_)) => self.end_list(),
            Event::Start(Tag::Item) => self.start_list_item(),
            Event::End(TagEnd::Item) => self.end_list_item(),
            Event::TaskListMarker(checked) => self.apply_task_marker(checked),
            Event::Start(Tag::CodeBlock(kind)) => self.start_code_block(kind),
            Event::End(TagEnd::CodeBlock) => self.end_code_block(),
            Event::Start(Tag::Table(_)) => self.start_table(),
            Event::End(TagEnd::Table) => self.end_table(),
            Event::Start(Tag::TableHead) => self.start_table_head(),
            Event::End(TagEnd::TableHead) => self.end_table_head(),
            Event::Start(Tag::TableRow) => self.start_table_row(),
            Event::End(TagEnd::TableRow) => self.end_table_row(),
            Event::Start(Tag::TableCell) => self.start_table_cell(),
            Event::End(TagEnd::TableCell) => self.end_table_cell(),
            Event::Start(Tag::Link { dest_url, .. }) => self.start_link(dest_url.as_ref()),
            Event::End(TagEnd::Link) => self.end_link(),
            Event::Start(Tag::Image { dest_url, .. }) => self.start_image(dest_url.as_ref()),
            Event::End(TagEnd::Image) => self.end_image(),
            Event::Start(Tag::Emphasis | Tag::Strong | Tag::Strikethrough) => {}
            Event::End(TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough) => {}
            Event::Text(text) => self.push_text(text.as_ref()),
            Event::Code(code) => self.push_inline_code(code.as_ref()),
            Event::SoftBreak => self.soft_break(),
            Event::HardBreak => self.hard_break(),
            Event::Rule => self.rule(),
            Event::Html(html) | Event::InlineHtml(html) => self.push_text(html.as_ref()),
            Event::FootnoteReference(name) => {
                self.push_text("[");
                self.push_text(name.as_ref());
                self.push_text("]");
            }
            _ => {}
        }
    }

    fn finish(mut self) -> Vec<SingleSessionStyledLine> {
        self.flush_current_line();
        if self
            .lines
            .last()
            .is_some_and(|line| line.style == SingleSessionLineStyle::Blank)
        {
            self.lines.pop();
        }
        self.lines
    }

    fn start_heading(&mut self, level: HeadingLevel) {
        self.flush_current_line();
        self.ensure_block_gap();
        self.current_style = SingleSessionLineStyle::AssistantHeading;
        self.pending_line_prefix = heading_prefix(level).to_string();
    }

    fn end_heading(&mut self) {
        self.flush_current_line_as(SingleSessionLineStyle::AssistantHeading);
        self.current_style = self.prose_style();
        self.pending_line_prefix.clear();
    }

    fn start_paragraph(&mut self) {
        if self.list_stack.is_empty() && self.quote_depth == 0 {
            self.ensure_block_gap();
        }
        self.current_style = self.prose_style();
    }

    fn end_paragraph(&mut self) {
        self.flush_current_line();
        if !self.item_continuation_prefixes.is_empty() {
            self.pending_line_prefix = self.continuation_prefix.clone();
        }
    }

    fn start_block_quote(&mut self) {
        self.flush_current_line();
        self.ensure_block_gap();
        self.quote_depth += 1;
        self.current_style = SingleSessionLineStyle::AssistantQuote;
    }

    fn end_block_quote(&mut self) {
        self.flush_current_line_as(SingleSessionLineStyle::AssistantQuote);
        self.quote_depth = self.quote_depth.saturating_sub(1);
        self.current_style = self.prose_style();
        self.pending_line_prefix.clear();
        self.continuation_prefix.clear();
    }

    fn start_list(&mut self, start: Option<u64>) {
        self.flush_current_line();
        if self.list_stack.is_empty() && self.quote_depth == 0 {
            self.ensure_block_gap();
        }
        self.list_stack
            .push(AssistantMarkdownList { next_number: start });
    }

    fn end_list(&mut self) {
        self.flush_current_line();
        self.list_stack.pop();
        if self.list_stack.is_empty() {
            self.pending_line_prefix.clear();
            self.continuation_prefix.clear();
            self.item_continuation_prefixes.clear();
        }
    }

    fn start_list_item(&mut self) {
        self.flush_current_line();
        let (prefix, continuation) = self.list_item_prefix(false);
        self.pending_line_prefix = prefix;
        self.continuation_prefix = continuation.clone();
        self.item_continuation_prefixes.push(continuation);
        self.current_style = self.prose_style();
    }

    fn end_list_item(&mut self) {
        self.flush_current_line();
        self.item_continuation_prefixes.pop();
        self.continuation_prefix = self
            .item_continuation_prefixes
            .last()
            .cloned()
            .unwrap_or_default();
        self.pending_line_prefix.clear();
    }

    fn apply_task_marker(&mut self, checked: bool) {
        let (prefix, continuation) = self.task_item_prefix(checked);
        if self.current.is_empty() {
            self.pending_line_prefix = prefix;
            self.continuation_prefix = continuation.clone();
            if let Some(last) = self.item_continuation_prefixes.last_mut() {
                *last = continuation;
            }
        } else {
            self.current.push_str(if checked { "✓ " } else { "☐ " });
        }
    }

    fn start_code_block(&mut self, kind: CodeBlockKind<'_>) {
        self.flush_current_line();
        self.ensure_block_gap();
        self.in_code_block = true;
        if let CodeBlockKind::Fenced(language) = kind {
            let language = language.as_ref().trim();
            if !language.is_empty() {
                self.lines.push(styled_line(
                    format!("  {language}"),
                    SingleSessionLineStyle::Code,
                ));
            }
        }
    }

    fn end_code_block(&mut self) {
        self.in_code_block = false;
    }

    fn start_table(&mut self) {
        self.flush_current_line();
        self.ensure_block_gap();
        self.table = Some(AssistantMarkdownTable::default());
    }

    fn end_table(&mut self) {
        if let Some(table) = self.table.take() {
            self.render_table(table);
        }
    }

    fn start_table_head(&mut self) {}

    fn end_table_head(&mut self) {
        if let Some(table) = &mut self.table {
            if !table.current_cell.trim().is_empty() {
                table.finish_cell();
            }
            table.finish_row();
            table.header_rows = table.rows.len();
        }
    }

    fn start_table_row(&mut self) {
        if let Some(table) = &mut self.table {
            table.current_row.clear();
        }
    }

    fn end_table_row(&mut self) {
        if let Some(table) = &mut self.table {
            if !table.current_cell.trim().is_empty() {
                table.finish_cell();
            }
            table.finish_row();
        }
    }

    fn start_table_cell(&mut self) {
        if let Some(table) = &mut self.table {
            table.current_cell.clear();
        }
    }

    fn end_table_cell(&mut self) {
        if let Some(table) = &mut self.table {
            table.finish_cell();
        }
    }

    fn start_link(&mut self, dest_url: &str) {
        self.begin_line_if_needed();
        self.link_stack.push(AssistantMarkdownLink {
            dest_url: dest_url.to_string(),
            start_byte: self.current.len(),
        });
    }

    fn end_link(&mut self) {
        let Some(link) = self.link_stack.pop() else {
            return;
        };
        if link.dest_url.is_empty() {
            return;
        }
        self.begin_line_if_needed();
        let label = self
            .current
            .get(link.start_byte..)
            .unwrap_or_default()
            .trim();
        if !label.contains(&link.dest_url) {
            self.current.push_str(" ↗ ");
            self.current.push_str(&link.dest_url);
        }
        if self.current_style == SingleSessionLineStyle::Assistant {
            self.line_style_override = Some(SingleSessionLineStyle::AssistantLink);
        }
    }

    fn start_image(&mut self, dest_url: &str) {
        self.image_stack.push(AssistantMarkdownImage {
            dest_url: dest_url.to_string(),
            alt_text: String::new(),
        });
    }

    fn end_image(&mut self) {
        let Some(image) = self.image_stack.pop() else {
            return;
        };
        self.begin_line_if_needed();
        let alt = image.alt_text.trim();
        if alt.is_empty() {
            self.current.push_str("image");
        } else {
            self.current.push_str("image: ");
            self.current.push_str(alt);
        }
        if !image.dest_url.is_empty() {
            self.current.push_str(" ↗ ");
            self.current.push_str(&image.dest_url);
        }
        if self.current_style == SingleSessionLineStyle::Assistant {
            self.line_style_override = Some(SingleSessionLineStyle::AssistantLink);
        }
    }

    fn push_text(&mut self, text: &str) {
        if let Some(image) = self.image_stack.last_mut() {
            image.alt_text.push_str(text);
            return;
        }
        if let Some(table) = &mut self.table {
            table.push_text(text);
            return;
        }
        if self.in_code_block {
            self.push_code_text(text);
            return;
        }
        self.begin_line_if_needed();
        self.current.push_str(&text.replace('\n', " "));
    }

    fn push_inline_code(&mut self, code: &str) {
        if let Some(table) = &mut self.table {
            table.push_text("`");
            table.push_text(code);
            table.push_text("`");
            return;
        }
        self.begin_line_if_needed();
        self.current.push('`');
        self.current.push_str(code);
        self.current.push('`');
    }

    fn soft_break(&mut self) {
        if let Some(table) = &mut self.table {
            table.push_space();
            return;
        }
        if self.in_code_block {
            self.lines
                .push(styled_line("  ", SingleSessionLineStyle::Code));
            return;
        }
        self.push_space();
    }

    fn hard_break(&mut self) {
        if let Some(table) = &mut self.table {
            table.push_space();
            return;
        }
        self.flush_current_line();
        if !self.continuation_prefix.is_empty() {
            self.pending_line_prefix = self.continuation_prefix.clone();
        } else if self.quote_depth > 0 {
            self.pending_line_prefix = self.quote_prefix();
        }
    }

    fn rule(&mut self) {
        self.flush_current_line();
        self.ensure_block_gap();
        self.lines
            .push(styled_line("────────────", SingleSessionLineStyle::Meta));
    }

    fn begin_line_if_needed(&mut self) {
        if !self.current.is_empty() {
            return;
        }
        if !self.pending_line_prefix.is_empty() {
            self.current.push_str(&self.pending_line_prefix);
            self.pending_line_prefix.clear();
            return;
        }
        if self.quote_depth > 0 {
            self.current.push_str(&self.quote_prefix());
        }
    }

    fn push_space(&mut self) {
        self.begin_line_if_needed();
        if !self.current.chars().last().is_some_and(char::is_whitespace) {
            self.current.push(' ');
        }
    }

    fn push_code_text(&mut self, text: &str) {
        if text.is_empty() {
            self.lines
                .push(styled_line("  ", SingleSessionLineStyle::Code));
            return;
        }
        for line in text.lines() {
            self.lines.push(styled_line(
                format!("  {line}"),
                SingleSessionLineStyle::Code,
            ));
        }
    }

    fn flush_current_line(&mut self) {
        let style = self
            .line_style_override
            .take()
            .unwrap_or(self.current_style);
        self.flush_current_line_as(style);
    }

    fn flush_current_line_as(&mut self, style: SingleSessionLineStyle) {
        let trimmed = self.current.trim_end();
        if !trimmed.is_empty() {
            self.lines.push(styled_line(trimmed, style));
        }
        self.current.clear();
        self.line_style_override = None;
    }

    fn ensure_block_gap(&mut self) {
        if self
            .lines
            .last()
            .is_some_and(|line| line.style != SingleSessionLineStyle::Blank)
        {
            self.lines.push(blank_styled_line());
        }
    }

    fn prose_style(&self) -> SingleSessionLineStyle {
        if self.quote_depth > 0 {
            SingleSessionLineStyle::AssistantQuote
        } else {
            SingleSessionLineStyle::Assistant
        }
    }

    fn quote_prefix(&self) -> String {
        "│ ".repeat(self.quote_depth)
    }

    fn list_item_prefix(&mut self, task: bool) -> (String, String) {
        let quote_prefix = self.quote_prefix();
        let depth = self.list_stack.len().saturating_sub(1);
        let indent = "  ".repeat(depth);
        let marker = if task {
            "☐ ".to_string()
        } else if let Some(list) = self.list_stack.last_mut() {
            if let Some(next_number) = &mut list.next_number {
                let marker = format!("{next_number}. ");
                *next_number += 1;
                marker
            } else {
                bullet_for_depth(depth).to_string()
            }
        } else {
            "• ".to_string()
        };
        let continuation = format!(
            "{quote_prefix}{indent}{}",
            " ".repeat(marker.chars().count())
        );
        (format!("{quote_prefix}{indent}{marker}"), continuation)
    }

    fn task_item_prefix(&self, checked: bool) -> (String, String) {
        let quote_prefix = self.quote_prefix();
        let depth = self.list_stack.len().saturating_sub(1);
        let indent = "  ".repeat(depth);
        let marker = if checked { "✓ " } else { "☐ " };
        let continuation = format!(
            "{quote_prefix}{indent}{}",
            " ".repeat(marker.chars().count())
        );
        (format!("{quote_prefix}{indent}{marker}"), continuation)
    }

    fn render_table(&mut self, table: AssistantMarkdownTable) {
        let header_rows = table.header_rows;
        let rows = table.non_empty_rows();
        if rows.is_empty() {
            return;
        }
        let column_count = rows.iter().map(Vec::len).max().unwrap_or(0);
        if column_count == 0 {
            return;
        }
        let mut widths = vec![0usize; column_count];
        for row in &rows {
            for (column, cell) in row.iter().enumerate() {
                widths[column] = widths[column].max(cell.chars().count());
            }
        }
        for (row_index, row) in rows.iter().enumerate() {
            self.lines.push(styled_line(
                format_table_row(row, &widths),
                SingleSessionLineStyle::AssistantTable,
            ));
            if header_rows > 0 && row_index + 1 == header_rows.min(rows.len()) {
                self.lines.push(styled_line(
                    format_table_separator(&widths),
                    SingleSessionLineStyle::AssistantTable,
                ));
            }
        }
    }
}

impl AssistantMarkdownTable {
    fn push_text(&mut self, text: &str) {
        self.current_cell.push_str(&text.replace('\n', " "));
    }

    fn push_space(&mut self) {
        if !self
            .current_cell
            .chars()
            .last()
            .is_some_and(char::is_whitespace)
        {
            self.current_cell.push(' ');
        }
    }

    fn finish_cell(&mut self) {
        self.current_row.push(self.current_cell.trim().to_string());
        self.current_cell.clear();
    }

    fn finish_row(&mut self) {
        if !self.current_row.is_empty() {
            self.rows.push(std::mem::take(&mut self.current_row));
        }
    }

    fn non_empty_rows(mut self) -> Vec<Vec<String>> {
        if !self.current_cell.trim().is_empty() {
            self.finish_cell();
        }
        self.finish_row();
        self.rows
            .into_iter()
            .filter(|row| row.iter().any(|cell| !cell.is_empty()))
            .collect()
    }
}

fn heading_prefix(level: HeadingLevel) -> &'static str {
    match level {
        HeadingLevel::H1 | HeadingLevel::H2 => "",
        HeadingLevel::H3 => "› ",
        _ => "· ",
    }
}

fn bullet_for_depth(depth: usize) -> &'static str {
    match depth % 3 {
        0 => "• ",
        1 => "◦ ",
        _ => "▪ ",
    }
}

fn format_table_row(row: &[String], widths: &[usize]) -> String {
    let mut rendered = String::new();
    for (column, width) in widths.iter().enumerate() {
        if column > 0 {
            rendered.push_str(" │ ");
        }
        let cell = row.get(column).map(String::as_str).unwrap_or_default();
        rendered.push_str(cell);
        rendered.push_str(&" ".repeat(width.saturating_sub(cell.chars().count())));
    }
    rendered.trim_end().to_string()
}

fn format_table_separator(widths: &[usize]) -> String {
    let mut rendered = String::new();
    for (column, width) in widths.iter().enumerate() {
        if column > 0 {
            rendered.push_str("─┼─");
        }
        rendered.push_str(&"─".repeat((*width).max(1)));
    }
    rendered
}

fn append_tool_lines(lines: &mut Vec<SingleSessionStyledLine>, content: &str, active: bool) {
    if content.is_empty() {
        return;
    }
    let mut raw_lines = content.lines();
    let Some(header) = raw_lines.next() else {
        return;
    };
    if !header.trim_start().starts_with(['▾', '▸']) {
        for line in std::iter::once(header).chain(raw_lines) {
            if !line.trim().is_empty() {
                lines.push(styled_line(
                    format!("  {}", line.trim()),
                    SingleSessionLineStyle::Tool,
                ));
            }
        }
        return;
    }
    let header = parse_tool_header(header);
    let mut metadata_lines = Vec::new();
    let mut widget_lines = Vec::new();
    for line in raw_lines {
        if let Some(raw_input) = line.strip_prefix("  input: ") {
            metadata_lines.extend(formatted_tool_input_lines(&header.name, raw_input));
        } else if !line.trim().is_empty() {
            widget_lines.push(compact_tool_widget_text(line.trim(), 112));
        }
    }

    lines.push(styled_line(
        format_tool_header_line_with_metadata(&header, &metadata_lines),
        SingleSessionLineStyle::Tool,
    ));

    if active
        && widget_lines.is_empty()
        && matches!(header.state.as_deref(), Some("preparing") | Some("running"))
    {
        widget_lines.push("waiting for tool output…".to_string());
    }

    if active && !widget_lines.is_empty() {
        append_tool_content_widget(lines, &widget_lines);
    }
}

#[derive(Debug, Eq, PartialEq)]
struct ToolHeader {
    name: String,
    state: Option<String>,
    summary: Option<String>,
}

fn parse_tool_header(line: &str) -> ToolHeader {
    let line = line.trim().trim_start_matches(['▾', '▸']).trim();
    let mut parts = line.splitn(2, char::is_whitespace);
    let name = parts
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or("tool");
    let rest = parts.next().unwrap_or_default().trim();
    if rest.is_empty() {
        return ToolHeader {
            name: name.to_string(),
            state: None,
            summary: None,
        };
    }

    let (state, summary) = rest
        .split_once(':')
        .map(|(state, summary)| (state.trim(), Some(summary.trim())))
        .unwrap_or((rest, None));

    ToolHeader {
        name: name.to_string(),
        state: Some(state.to_string()).filter(|state| !state.is_empty()),
        summary: summary
            .filter(|summary| !summary.is_empty())
            .map(|summary| compact_tool_text(summary, 116)),
    }
}

#[cfg(test)]
fn format_tool_header_line(header: &ToolHeader) -> String {
    format_tool_header_line_with_metadata(header, &[])
}

fn format_tool_header_line_with_metadata(header: &ToolHeader, metadata_lines: &[String]) -> String {
    let icon = match header.state.as_deref() {
        Some("done") => "✓",
        Some("failed") => "✕",
        Some("running") => "●",
        Some("preparing") => "○",
        _ => "•",
    };
    let mut line = match (&header.state, &header.summary) {
        (Some(state), Some(summary)) => format!("  {icon} {} · {state} · {summary}", header.name),
        (Some(state), None) => format!("  {icon} {} · {state}", header.name),
        (None, Some(summary)) => format!("  {icon} {} · {summary}", header.name),
        (None, None) => format!("  {icon} {}", header.name),
    };

    if let Some(metadata) = compact_tool_metadata(metadata_lines) {
        line.push_str(" · ");
        line.push_str(&metadata);
    }
    line
}

fn compact_tool_metadata(metadata_lines: &[String]) -> Option<String> {
    let metadata = metadata_lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" · ");
    (!metadata.is_empty()).then(|| compact_tool_text(&metadata, 116))
}

fn append_tool_content_widget(lines: &mut Vec<SingleSessionStyledLine>, content_lines: &[String]) {
    const MAX_WIDGET_LINES: usize = 12;
    const WIDGET_WIDTH: usize = 68;

    lines.push(styled_line(
        format!("  ╭{}╮", "─".repeat(WIDGET_WIDTH)),
        SingleSessionLineStyle::Tool,
    ));
    for line in content_lines.iter().take(MAX_WIDGET_LINES) {
        lines.push(styled_line(
            format_tool_widget_content_line(line, WIDGET_WIDTH),
            SingleSessionLineStyle::Tool,
        ));
    }
    if content_lines.len() > MAX_WIDGET_LINES {
        lines.push(styled_line(
            format_tool_widget_content_line(
                &format!("… {} more lines", content_lines.len() - MAX_WIDGET_LINES),
                WIDGET_WIDTH,
            ),
            SingleSessionLineStyle::Tool,
        ));
    }
    lines.push(styled_line(
        format!("  ╰{}╯", "─".repeat(WIDGET_WIDTH)),
        SingleSessionLineStyle::Tool,
    ));
}

fn format_tool_widget_content_line(line: &str, width: usize) -> String {
    let line = compact_tool_widget_text(line, width);
    let padding = width.saturating_sub(line.chars().count());
    format!("  │{line}{}│", " ".repeat(padding))
}

fn compact_tool_widget_text(text: &str, max_chars: usize) -> String {
    let text = text.trim().replace('\t', "    ");
    if text.chars().count() > max_chars {
        format!(
            "{}…",
            text.chars()
                .take(max_chars.saturating_sub(1))
                .collect::<String>()
        )
    } else {
        text
    }
}

fn append_tool_group_summary(
    lines: &mut Vec<SingleSessionStyledLine>,
    tool_messages: &[SingleSessionMessage],
) {
    if tool_messages.is_empty() {
        return;
    }

    let mut names: Vec<String> = Vec::new();
    let mut counts: Vec<usize> = Vec::new();
    let mut approx_tokens = 0usize;

    for message in tool_messages {
        approx_tokens += message.content.chars().count().div_ceil(4);
        let name = tool_summary_name(&message.content);
        if let Some(index) = names.iter().position(|existing| existing == &name) {
            counts[index] += 1;
        } else {
            names.push(name);
            counts.push(1);
        }
    }

    let fragments = names
        .into_iter()
        .zip(counts)
        .map(|(name, count)| format!("{count} {name}"))
        .collect::<Vec<_>>()
        .join(", ");
    let token_fragment = format_approx_tokens(approx_tokens);
    lines.push(styled_line(
        format!("  ▸ tools: {fragments} · ~{token_fragment} tokens"),
        SingleSessionLineStyle::Tool,
    ));
}

fn tool_summary_name(content: &str) -> String {
    content
        .lines()
        .next()
        .unwrap_or("tool")
        .trim_start_matches(['▾', '▸'])
        .trim()
        .split_whitespace()
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("tool")
        .to_string()
}

fn format_approx_tokens(tokens: usize) -> String {
    if tokens >= 10_000 {
        format!("{}k", ((tokens + 500) / 1000))
    } else if tokens >= 1_000 {
        let tenths = (tokens + 50) / 100;
        format!("{}.{}k", tenths / 10, tenths % 10)
    } else {
        tokens.to_string()
    }
}

fn formatted_tool_input_lines(tool_name: &str, raw_input: &str) -> Vec<String> {
    const MAX_INPUT_LINES: usize = 6;
    let raw_input = raw_input.trim();
    if raw_input.is_empty() {
        return vec!["input: <empty>".to_string()];
    }

    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw_input) else {
        return vec![format!("input: {}", compact_tool_text(raw_input, 132))];
    };

    let serde_json::Value::Object(map) = value else {
        return vec![format!(
            "input: {}",
            compact_tool_json_value("input", &value)
        )];
    };

    if map.is_empty() {
        return vec!["input: {}".to_string()];
    }

    if let Some(lines) = formatted_tool_input_summary(tool_name, &map) {
        return lines;
    }

    let mut keys = map.keys().cloned().collect::<Vec<_>>();
    keys.sort_by(|left, right| {
        tool_input_key_priority(left)
            .cmp(&tool_input_key_priority(right))
            .then_with(|| left.cmp(right))
    });

    let total = keys.len();
    let mut rendered = keys
        .into_iter()
        .take(MAX_INPUT_LINES)
        .filter_map(|key| {
            map.get(&key)
                .map(|value| format!("{key}: {}", compact_tool_json_value(&key, value)))
        })
        .collect::<Vec<_>>();
    if total > MAX_INPUT_LINES {
        rendered.push(format!("… {} more", total - MAX_INPUT_LINES));
    }
    rendered
}

fn formatted_tool_input_summary(
    tool_name: &str,
    map: &serde_json::Map<String, serde_json::Value>,
) -> Option<Vec<String>> {
    let string_value = |key: &str| map.get(key).and_then(serde_json::Value::as_str);
    let bool_value = |key: &str| map.get(key).and_then(serde_json::Value::as_bool);
    let mut lines = Vec::new();

    match tool_name {
        "bash" => {
            if let Some(command) = string_value("command") {
                lines.push(format!("$ {}", compact_tool_text(command, 132)));
            }
        }
        "read" => {
            if let Some(path) = string_value("file_path") {
                lines.push(format!("read {}", compact_tool_text(path, 132)));
            }
        }
        "write" | "edit" | "multiedit" => {
            if let Some(path) = string_value("file_path") {
                lines.push(format!("file {}", compact_tool_text(path, 132)));
            }
        }
        "agentgrep" | "grep" => {
            if let Some(query) = string_value("query").or_else(|| string_value("pattern")) {
                lines.push(format!("search {}", compact_tool_text(query, 132)));
            }
            if let Some(path) = string_value("path") {
                lines.push(format!("in {}", compact_tool_text(path, 132)));
            }
        }
        "webfetch" | "websearch" => {
            if let Some(query) = string_value("query").or_else(|| string_value("url")) {
                lines.push(compact_tool_text(query, 132));
            }
        }
        "browser" => {
            if let Some(action) = string_value("action") {
                let target = string_value("url")
                    .or_else(|| string_value("selector"))
                    .or_else(|| string_value("text"));
                lines.push(match target {
                    Some(target) => format!("{action} {}", compact_tool_text(target, 112)),
                    None => action.to_string(),
                });
            }
        }
        _ => {}
    }

    if let Some(intent) = string_value("intent").filter(|intent| !intent.trim().is_empty()) {
        lines.insert(0, format!("intent: {}", compact_tool_text(intent, 112)));
    }
    if bool_value("run_in_background") == Some(true) {
        lines.push("background: yes".to_string());
    }

    (!lines.is_empty()).then_some(lines)
}

fn tool_input_key_priority(key: &str) -> usize {
    match key {
        "intent" => 0,
        "command" => 1,
        "file_path" | "path" => 2,
        "query" => 3,
        "pattern" | "glob" => 4,
        "url" => 5,
        "task" | "prompt" => 6,
        _ => 100,
    }
}

fn compact_tool_json_value(key: &str, value: &serde_json::Value) -> String {
    if is_sensitive_tool_input_key(key) {
        return "••••".to_string();
    }
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::String(value) => {
            if key.to_ascii_lowercase().contains("base64") {
                format!("<base64, {} chars>", value.chars().count())
            } else {
                compact_tool_text(value, 108)
            }
        }
        serde_json::Value::Array(values) => {
            if values.is_empty() {
                "[]".to_string()
            } else if values.len() <= 3 && values.iter().all(is_compact_tool_scalar) {
                let joined = values
                    .iter()
                    .map(|value| compact_tool_json_value(key, value))
                    .collect::<Vec<_>>()
                    .join(", ");
                compact_tool_text(&format!("[{joined}]"), 108)
            } else {
                format!("[{} items]", values.len())
            }
        }
        serde_json::Value::Object(map) => format!("{{{} fields}}", map.len()),
    }
}

fn is_compact_tool_scalar(value: &serde_json::Value) -> bool {
    matches!(
        value,
        serde_json::Value::Null
            | serde_json::Value::Bool(_)
            | serde_json::Value::Number(_)
            | serde_json::Value::String(_)
    )
}

fn is_sensitive_tool_input_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("password") || key.contains("token") || key.contains("secret")
}

fn compact_tool_text(text: &str, max_chars: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() > max_chars {
        format!("{}…", text.chars().take(max_chars).collect::<String>())
    } else {
        text
    }
}

fn merge_tool_finish_with_existing_context(existing: &str, finish_line: &str) -> String {
    let context = existing
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    if context.is_empty() {
        finish_line.to_string()
    } else {
        format!("{}\n{}", finish_line, context.join("\n"))
    }
}

fn append_meta_lines(lines: &mut Vec<SingleSessionStyledLine>, content: &str) {
    if content.is_empty() {
        return;
    }
    lines.push(styled_line(
        format!("  {content}"),
        SingleSessionLineStyle::Meta,
    ));
}

fn previous_char_boundary(text: &str, cursor: usize) -> usize {
    text[..cursor.min(text.len())]
        .char_indices()
        .last()
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn next_char_boundary(text: &str, cursor: usize) -> usize {
    if cursor >= text.len() {
        return text.len();
    }
    text[cursor..]
        .char_indices()
        .nth(1)
        .map(|(offset, _)| cursor + offset)
        .unwrap_or(text.len())
}

fn previous_word_start(text: &str, cursor: usize) -> usize {
    let mut start = cursor.min(text.len());
    while start > 0 {
        let previous = previous_char_boundary(text, start);
        let ch = text[previous..start].chars().next().unwrap_or_default();
        if !ch.is_whitespace() {
            break;
        }
        start = previous;
    }
    while start > 0 {
        let previous = previous_char_boundary(text, start);
        let ch = text[previous..start].chars().next().unwrap_or_default();
        if ch.is_whitespace() {
            break;
        }
        start = previous;
    }
    start
}

fn next_word_end(text: &str, cursor: usize) -> usize {
    let mut end = cursor.min(text.len());
    while end < text.len() {
        let next = next_char_boundary(text, end);
        let ch = text[end..next].chars().next().unwrap_or_default();
        if !ch.is_whitespace() {
            break;
        }
        end = next;
    }
    while end < text.len() {
        let next = next_char_boundary(text, end);
        let ch = text[end..next].chars().next().unwrap_or_default();
        if ch.is_whitespace() {
            break;
        }
        end = next;
    }
    end
}

fn line_start(text: &str, cursor: usize) -> usize {
    text[..cursor.min(text.len())]
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0)
}

fn line_end(text: &str, cursor: usize) -> usize {
    text[cursor.min(text.len())..]
        .find('\n')
        .map(|offset| cursor + offset)
        .unwrap_or(text.len())
}

fn short_session_id(session_id: &str) -> &str {
    session_id
        .strip_prefix("session_")
        .and_then(|rest| rest.split('_').next())
        .filter(|name| !name.is_empty())
        .unwrap_or(session_id)
}

pub(crate) fn single_session_surface(
    session: Option<&workspace::SessionCard>,
) -> workspace::Surface {
    let lines = single_session_lines(session);
    workspace::Surface {
        id: 1,
        title: session
            .map(|session| session.title.clone())
            .unwrap_or_else(|| "new jcode session".to_string()),
        body_lines: lines.clone(),
        detail_lines: lines,
        session_id: session.map(|session| session.session_id.clone()),
        lane: 0,
        column: 0,
        color_index: 0,
    }
}

pub(crate) fn single_session_lines(session: Option<&workspace::SessionCard>) -> Vec<String> {
    single_session_styled_lines(session)
        .into_iter()
        .map(|line| line.text)
        .collect()
}

pub(crate) fn single_session_styled_lines(
    session: Option<&workspace::SessionCard>,
) -> Vec<SingleSessionStyledLine> {
    let Some(session) = session else {
        return vec![
            styled_line("single session mode", SingleSessionLineStyle::OverlayTitle),
            styled_line(
                "fresh desktop-native session draft",
                SingleSessionLineStyle::Status,
            ),
            styled_line(
                "type here without nav or insert modes",
                SingleSessionLineStyle::Overlay,
            ),
            styled_line(
                "Enter sends through the shared desktop session runtime",
                SingleSessionLineStyle::Overlay,
            ),
            styled_line(
                "ctrl+; clears this draft and starts another fresh desktop session",
                SingleSessionLineStyle::Overlay,
            ),
            styled_line(
                "run with --workspace for the niri layout wrapper",
                SingleSessionLineStyle::Overlay,
            ),
        ];
    };

    let mut lines = vec![
        styled_line("single session mode", SingleSessionLineStyle::OverlayTitle),
        styled_line(session.subtitle.clone(), SingleSessionLineStyle::Status),
        styled_line(session.detail.clone(), SingleSessionLineStyle::Meta),
    ];
    if !session.preview_lines.is_empty() {
        lines.push(styled_line(
            "recent transcript",
            SingleSessionLineStyle::OverlayTitle,
        ));
        lines.extend(
            session
                .preview_lines
                .iter()
                .cloned()
                .map(|line| styled_line(line, SingleSessionLineStyle::Assistant)),
        );
    }
    if !session.detail_lines.is_empty() {
        lines.push(styled_line(
            "expanded transcript",
            SingleSessionLineStyle::OverlayTitle,
        ));
        lines.extend(
            session
                .detail_lines
                .iter()
                .cloned()
                .map(|line| styled_line(line, SingleSessionLineStyle::Assistant)),
        );
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rendered_tool_text(content: &str, active: bool) -> Vec<String> {
        let mut lines = Vec::new();
        append_tool_lines(&mut lines, content, active);
        lines.into_iter().map(|line| line.text).collect()
    }

    #[test]
    fn tool_header_uses_status_icons_and_compact_summary() {
        assert_eq!(
            format_tool_header_line(&parse_tool_header("▾ bash done: completed successfully")),
            "  ✓ bash · done · completed successfully"
        );
        assert_eq!(
            format_tool_header_line(&parse_tool_header("▾ browser failed: selector missing")),
            "  ✕ browser · failed · selector missing"
        );
    }

    #[test]
    fn bash_tool_rendering_shows_intent_command_and_background_flag() {
        let lines = rendered_tool_text(
            "▾ bash running\n  input: {\"intent\":\"run the desktop tests\",\"command\":\"cargo test -p jcode-desktop\",\"run_in_background\":true}",
            true,
        );
        assert_eq!(
            lines,
            vec![
                "  ● bash · running · intent: run the desktop tests · $ cargo test -p jcode-desktop · background: yes",
                "  ╭────────────────────────────────────────────────────────────────────╮",
                "  │waiting for tool output…                                            │",
                "  ╰────────────────────────────────────────────────────────────────────╯",
            ]
        );
    }

    #[test]
    fn tool_result_content_renders_inside_inline_widget() {
        let lines = rendered_tool_text(
            "▾ bash failed: tests failed\n  input: {\"command\":\"cargo test -p jcode-desktop\"}\n  error[E0425]: cannot find value `foo` in this scope\n  test result: FAILED",
            true,
        );

        assert_eq!(
            lines[0],
            "  ✕ bash · failed · tests failed · $ cargo test -p jcode-desktop"
        );
        assert_eq!(
            lines[1],
            "  ╭────────────────────────────────────────────────────────────────────╮"
        );
        assert_eq!(
            lines[2],
            "  │error[E0425]: cannot find value `foo` in this scope                 │"
        );
        assert_eq!(
            lines[3],
            "  │test result: FAILED                                                 │"
        );
        assert_eq!(
            lines[4],
            "  ╰────────────────────────────────────────────────────────────────────╯"
        );
    }

    #[test]
    fn inactive_tool_result_compacts_to_metadata_only() {
        let lines = rendered_tool_text(
            "▾ bash done: tests passed\n  input: {\"command\":\"cargo test -p jcode-desktop\"}\n  test result: ok",
            false,
        );

        assert_eq!(
            lines,
            vec!["  ✓ bash · done · tests passed · $ cargo test -p jcode-desktop"]
        );
    }

    #[test]
    fn unknown_tool_falls_back_to_prioritized_key_value_lines() {
        let lines = formatted_tool_input_lines(
            "custom",
            "{\"token\":\"secret\",\"query\":\"tool calls\",\"extra\":42}",
        );
        assert_eq!(lines, vec!["query: tool calls", "extra: 42", "token: ••••"]);
    }
}
