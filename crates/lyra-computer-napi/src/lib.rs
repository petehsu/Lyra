use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use napi::{Error, Result, Status};
use napi_derive::napi;
use serde::{Deserialize, Serialize};

const POWER_OFF: &str = "off";
const POWER_BOOTING: &str = "booting";
const POWER_ON: &str = "on";
const POWER_SHUTTING_DOWN: &str = "shutting_down";

const APP_KIND_DESKTOP: &str = "desktop";
const APP_KIND_FILE_MANAGER: &str = "file-manager";
const APP_KIND_FILE_EDITOR: &str = "file-editor";
const APP_KIND_TERMINAL: &str = "terminal";
const APP_KIND_BROWSER: &str = "browser";

const WINDOW_NORMAL: &str = "normal";
const WINDOW_MINIMIZED: &str = "minimized";
const WINDOW_MAXIMIZED: &str = "maximized";

const MIN_WINDOW_WIDTH: f64 = 320.0;
const MIN_WINDOW_HEIGHT: f64 = 220.0;
const MAX_WINDOW_WIDTH: f64 = 20_000.0;
const MAX_WINDOW_HEIGHT: f64 = 20_000.0;
const MAX_WINDOW_COORDINATE: f64 = 20_000.0;

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiComputerWindowFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiComputerAppInstance {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub opened_at: String,
    pub last_focused_at: String,
    #[serde(default = "default_window_state")]
    pub window_state: String,
    #[serde(default = "default_window_frame")]
    pub frame: AiComputerWindowFrame,
    #[serde(default)]
    pub last_normal_frame: Option<AiComputerWindowFrame>,
    #[serde(default)]
    pub z_index: u32,
    pub file_path: Option<String>,
    pub directory_path: Option<String>,
    pub address: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiComputerSessionState {
    pub session_id: String,
    pub has_booted: bool,
    pub power_state: String,
    pub boot_reason: Option<String>,
    pub open_apps: Vec<AiComputerAppInstance>,
    pub active_app_id: Option<String>,
    pub updated_at: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSessionRequest {
    pub storage_root: String,
    pub session_id: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerRequest {
    pub storage_root: String,
    pub session_id: String,
    pub reason: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerOffRequest {
    pub storage_root: String,
    pub session_id: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishPowerTransitionRequest {
    pub storage_root: String,
    pub session_id: String,
    pub target_state: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAppRequest {
    pub storage_root: String,
    pub session_id: String,
    pub kind: String,
    pub title: Option<String>,
    pub app_instance_id: Option<String>,
    pub file_path: Option<String>,
    pub directory_path: Option<String>,
    pub address: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusAppRequest {
    pub storage_root: String,
    pub session_id: String,
    pub app_instance_id: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseAppRequest {
    pub storage_root: String,
    pub session_id: String,
    pub app_instance_id: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowActionRequest {
    pub storage_root: String,
    pub session_id: String,
    pub app_instance_id: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWindowFrameRequest {
    pub storage_root: String,
    pub session_id: String,
    pub app_instance_id: String,
    pub frame: AiComputerWindowFrame,
}

fn now_string() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn default_window_state() -> String {
    WINDOW_NORMAL.to_string()
}

fn default_window_frame() -> AiComputerWindowFrame {
    AiComputerWindowFrame {
        x: 96.0,
        y: 84.0,
        width: 820.0,
        height: 520.0,
    }
}

fn create_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn normalize_required(value: &str, field_name: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(create_error(format!("{} is required", field_name)));
    }
    Ok(trimmed.to_string())
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn validate_power_state(value: &str) -> Result<String> {
    match value {
        POWER_OFF | POWER_BOOTING | POWER_ON | POWER_SHUTTING_DOWN => Ok(value.to_string()),
        _ => Err(create_error("invalid computer power state")),
    }
}

fn validate_boot_reason(value: &str) -> Result<String> {
    match value {
        "user" | "ai" => Ok(value.to_string()),
        _ => Err(create_error("invalid computer boot reason")),
    }
}

fn validate_app_kind(value: &str) -> Result<String> {
    match value {
        APP_KIND_DESKTOP
        | APP_KIND_FILE_MANAGER
        | APP_KIND_FILE_EDITOR
        | APP_KIND_TERMINAL
        | APP_KIND_BROWSER => Ok(value.to_string()),
        _ => Err(create_error("invalid computer app kind")),
    }
}

fn validate_window_state(value: &str) -> Result<String> {
    match value {
        WINDOW_NORMAL | WINDOW_MINIMIZED | WINDOW_MAXIMIZED => Ok(value.to_string()),
        _ => Err(create_error("invalid computer window state")),
    }
}

fn clamp_frame(frame: AiComputerWindowFrame) -> AiComputerWindowFrame {
    let sanitized_x = if frame.x.is_finite() { frame.x } else { 0.0 };
    let sanitized_y = if frame.y.is_finite() { frame.y } else { 0.0 };
    let sanitized_width = if frame.width.is_finite() {
        frame.width
    } else {
        MIN_WINDOW_WIDTH
    };
    let sanitized_height = if frame.height.is_finite() {
        frame.height
    } else {
        MIN_WINDOW_HEIGHT
    };

    AiComputerWindowFrame {
        x: sanitized_x
            .max(-MAX_WINDOW_COORDINATE)
            .min(MAX_WINDOW_COORDINATE),
        y: sanitized_y
            .max(-MAX_WINDOW_COORDINATE)
            .min(MAX_WINDOW_COORDINATE),
        width: sanitized_width.max(MIN_WINDOW_WIDTH).min(MAX_WINDOW_WIDTH),
        height: sanitized_height
            .max(MIN_WINDOW_HEIGHT)
            .min(MAX_WINDOW_HEIGHT),
    }
}

fn create_default_app_frame(kind: &str, cascade_index: usize) -> AiComputerWindowFrame {
    let (width, height) = match kind {
        APP_KIND_FILE_MANAGER => (860.0, 560.0),
        APP_KIND_FILE_EDITOR => (900.0, 580.0),
        APP_KIND_TERMINAL => (780.0, 460.0),
        APP_KIND_BROWSER => (920.0, 600.0),
        _ => (820.0, 520.0),
    };
    let offset_x = 34.0 * (cascade_index as f64 % 6.0);
    let offset_y = 26.0 * (cascade_index as f64 % 5.0);
    clamp_frame(AiComputerWindowFrame {
        x: 72.0 + offset_x,
        y: 64.0 + offset_y,
        width,
        height,
    })
}

fn sanitize_session_file_name(session_id: &str) -> String {
    let mut output = String::with_capacity(session_id.len());
    for ch in session_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            output.push(ch);
        } else {
            output.push('_');
        }
    }
    if output.is_empty() {
        "session".to_string()
    } else {
        output
    }
}

fn sessions_dir(storage_root: &str) -> PathBuf {
    Path::new(storage_root).join("sessions")
}

fn session_path(storage_root: &str, session_id: &str) -> PathBuf {
    sessions_dir(storage_root).join(format!("{}.json", sanitize_session_file_name(session_id)))
}

fn default_state(session_id: &str) -> AiComputerSessionState {
    AiComputerSessionState {
        session_id: session_id.to_string(),
        has_booted: false,
        power_state: POWER_OFF.to_string(),
        boot_reason: None,
        open_apps: Vec::new(),
        active_app_id: None,
        updated_at: now_string(),
    }
}

fn default_app_title(
    kind: &str,
    file_path: Option<&String>,
    directory_path: Option<&String>,
    address: Option<&String>,
) -> String {
    match kind {
        APP_KIND_FILE_MANAGER => directory_path
            .map(|value| format!("Files · {}", value))
            .unwrap_or_else(|| "Files".to_string()),
        APP_KIND_FILE_EDITOR => file_path
            .map(|value| format!("Editor · {}", value))
            .unwrap_or_else(|| "Editor".to_string()),
        APP_KIND_TERMINAL => "Terminal".to_string(),
        APP_KIND_BROWSER => address
            .map(|value| format!("Browser · {}", value))
            .unwrap_or_else(|| "Browser".to_string()),
        _ => "Desktop".to_string(),
    }
}

fn next_z_index(state: &AiComputerSessionState) -> u32 {
    state
        .open_apps
        .iter()
        .map(|entry| entry.z_index)
        .max()
        .unwrap_or(0)
        + 1
}

fn highest_visible_app_id(state: &AiComputerSessionState) -> Option<String> {
    state
        .open_apps
        .iter()
        .filter(|entry| entry.window_state != WINDOW_MINIMIZED)
        .max_by_key(|entry| entry.z_index)
        .map(|entry| entry.id.clone())
}

fn raise_to_front(state: &mut AiComputerSessionState, app_instance_id: &str) {
    let next_z = next_z_index(state);
    let now = now_string();
    if let Some(target) = state
        .open_apps
        .iter_mut()
        .find(|entry| entry.id == app_instance_id)
    {
        target.z_index = next_z;
        target.last_focused_at = now.clone();
        state.active_app_id = Some(target.id.clone());
        state.updated_at = now;
    }
}

fn restore_window_to_normal(
    app: &mut AiComputerAppInstance,
    fallback_frame: AiComputerWindowFrame,
) {
    let frame = app
        .last_normal_frame
        .clone()
        .unwrap_or_else(|| clamp_frame(fallback_frame));
    app.window_state = WINDOW_NORMAL.to_string();
    app.frame = clamp_frame(frame.clone());
    app.last_normal_frame = Some(clamp_frame(frame));
}

fn sanitize_state(mut state: AiComputerSessionState) -> AiComputerSessionState {
    let mut next_z = 1u32;
    for (index, app) in state.open_apps.iter_mut().enumerate() {
        app.kind = validate_app_kind(&app.kind).unwrap_or_else(|_| APP_KIND_BROWSER.to_string());
        app.window_state =
            validate_window_state(&app.window_state).unwrap_or_else(|_| WINDOW_NORMAL.to_string());
        app.frame = clamp_frame(if app.frame.width <= 0.0 || app.frame.height <= 0.0 {
            create_default_app_frame(&app.kind, index)
        } else {
            app.frame.clone()
        });
        app.last_normal_frame = app.last_normal_frame.take().map(clamp_frame).or_else(|| {
            if app.window_state == WINDOW_NORMAL {
                Some(app.frame.clone())
            } else {
                None
            }
        });
        if app.z_index == 0 {
            app.z_index = next_z;
        }
        next_z = next_z.max(app.z_index + 1);
    }

    if let Some(active_id) = state.active_app_id.clone() {
        let has_active = state
            .open_apps
            .iter()
            .any(|entry| entry.id == active_id && entry.window_state != WINDOW_MINIMIZED);
        if !has_active {
            state.active_app_id = highest_visible_app_id(&state);
        }
    } else {
        state.active_app_id = highest_visible_app_id(&state);
    }
    state
}

fn load_state(storage_root: &str, session_id: &str) -> Result<AiComputerSessionState> {
    let session_id = normalize_required(session_id, "sessionId")?;
    let target_path = session_path(storage_root, &session_id);
    if !target_path.exists() {
        return Ok(default_state(&session_id));
    }

    let raw = fs::read_to_string(&target_path)
        .map_err(|error| create_error(format!("failed to read computer session: {}", error)))?;
    let parsed: AiComputerSessionState = serde_json::from_str(&raw)
        .map_err(|error| create_error(format!("failed to decode computer session: {}", error)))?;
    Ok(sanitize_state(parsed))
}

fn save_state(storage_root: &str, state: &AiComputerSessionState) -> Result<()> {
    let dir = sessions_dir(storage_root);
    fs::create_dir_all(&dir)
        .map_err(|error| create_error(format!("failed to create computer storage: {}", error)))?;
    let raw = serde_json::to_string_pretty(state)
        .map_err(|error| create_error(format!("failed to encode computer session: {}", error)))?;
    fs::write(session_path(storage_root, &state.session_id), raw)
        .map_err(|error| create_error(format!("failed to persist computer session: {}", error)))?;
    Ok(())
}

fn upsert_app(
    mut state: AiComputerSessionState,
    request: &OpenAppRequest,
) -> Result<AiComputerSessionState> {
    let session_id = normalize_required(&request.session_id, "sessionId")?;
    let kind = validate_app_kind(&request.kind)?;
    let now = now_string();
    let normalized_title = normalize_optional(request.title.clone());
    let normalized_file_path = normalize_optional(request.file_path.clone());
    let normalized_directory_path = normalize_optional(request.directory_path.clone());
    let normalized_address = normalize_optional(request.address.clone());
    let normalized_app_id = normalize_optional(request.app_instance_id.clone());

    let existing_index = if let Some(app_id) = normalized_app_id.as_ref() {
        state.open_apps.iter().position(|entry| entry.id == *app_id)
    } else {
        state.open_apps.iter().position(|entry| {
            entry.kind == kind
                && ((normalized_file_path.is_some() && entry.file_path == normalized_file_path)
                    || (normalized_directory_path.is_some()
                        && entry.directory_path == normalized_directory_path)
                    || (normalized_address.is_some() && entry.address == normalized_address)
                    || (normalized_file_path.is_none()
                        && normalized_directory_path.is_none()
                        && normalized_address.is_none()
                        && entry.kind == kind))
        })
    };

    let next_app_id = normalized_app_id
        .clone()
        .unwrap_or_else(|| format!("{}-{}", kind, now));

    let title = normalized_title.unwrap_or_else(|| {
        default_app_title(
            &kind,
            normalized_file_path.as_ref(),
            normalized_directory_path.as_ref(),
            normalized_address.as_ref(),
        )
    });

    if let Some(index) = existing_index {
        let current = state.open_apps[index].clone();
        let next_kind = kind.clone();
        let mut next = AiComputerAppInstance {
            id: current.id,
            kind: next_kind.clone(),
            title,
            opened_at: current.opened_at,
            last_focused_at: now.clone(),
            window_state: current.window_state,
            frame: current.frame,
            last_normal_frame: current.last_normal_frame,
            z_index: current.z_index,
            file_path: normalized_file_path.or(current.file_path),
            directory_path: normalized_directory_path.or(current.directory_path),
            address: normalized_address.or(current.address),
        };
        if next.window_state == WINDOW_MINIMIZED {
            let default_frame = create_default_app_frame(&next_kind, index);
            restore_window_to_normal(&mut next, default_frame);
        }
        let next_id = next.id.clone();
        state.open_apps[index] = next;
        raise_to_front(&mut state, &next_id);
    } else {
        let default_frame = create_default_app_frame(&kind, state.open_apps.len());
        let mut app = AiComputerAppInstance {
            id: next_app_id.clone(),
            kind,
            title,
            opened_at: now.clone(),
            last_focused_at: now.clone(),
            window_state: WINDOW_NORMAL.to_string(),
            frame: default_frame,
            last_normal_frame: None,
            z_index: 0,
            file_path: normalized_file_path,
            directory_path: normalized_directory_path,
            address: normalized_address,
        };
        app.last_normal_frame = Some(app.frame.clone());
        app.z_index = next_z_index(&state);
        state.open_apps.push(app);
        state.active_app_id = Some(next_app_id);
        state.updated_at = now.clone();
    }

    state.session_id = session_id;
    if state.updated_at != now {
        state.updated_at = now;
    }
    Ok(state)
}

fn update_window_frame(
    mut state: AiComputerSessionState,
    app_instance_id: &str,
    frame: AiComputerWindowFrame,
    preserve_maximized: bool,
) -> Result<AiComputerSessionState> {
    let app_instance_id = normalize_required(app_instance_id, "appInstanceId")?;
    let now = now_string();
    if let Some(target) = state
        .open_apps
        .iter_mut()
        .find(|entry| entry.id == app_instance_id)
    {
        let next_frame = clamp_frame(frame);
        if preserve_maximized && target.window_state == WINDOW_MAXIMIZED {
            target.last_normal_frame = Some(next_frame.clone());
        } else {
            target.frame = next_frame.clone();
            target.last_normal_frame = Some(next_frame);
            target.window_state = WINDOW_NORMAL.to_string();
        }
        target.last_focused_at = now.clone();
    }
    raise_to_front(&mut state, &app_instance_id);
    state.updated_at = now;
    Ok(state)
}

#[napi]
pub fn read_session(request: ReadSessionRequest) -> Result<AiComputerSessionState> {
    load_state(&request.storage_root, &request.session_id)
}

#[napi]
pub fn power_on_session(request: PowerRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    state.has_booted = true;
    state.boot_reason = Some(validate_boot_reason(&request.reason)?);
    state.power_state = match state.power_state.as_str() {
        POWER_ON => POWER_ON.to_string(),
        _ => POWER_BOOTING.to_string(),
    };
    state.updated_at = now_string();
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn power_off_session(request: PowerOffRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    state.power_state = match state.power_state.as_str() {
        POWER_OFF => POWER_OFF.to_string(),
        _ => POWER_SHUTTING_DOWN.to_string(),
    };
    state.updated_at = now_string();
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn finish_power_transition(
    request: FinishPowerTransitionRequest,
) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    let target_state = validate_power_state(&request.target_state)?;
    state.power_state = target_state.clone();
    if target_state == POWER_OFF {
        state.boot_reason = None;
        state.active_app_id = None;
    }
    state.updated_at = now_string();
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn open_app(request: OpenAppRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    state = upsert_app(state, &request)?;
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn focus_app(request: FocusAppRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    let app_instance_id = normalize_required(&request.app_instance_id, "appInstanceId")?;
    if let Some(index) = state
        .open_apps
        .iter()
        .position(|entry| entry.id == app_instance_id)
    {
        let fallback = create_default_app_frame(&state.open_apps[index].kind, index);
        if state.open_apps[index].window_state == WINDOW_MINIMIZED {
            let target = state.open_apps.get_mut(index).expect("index exists");
            restore_window_to_normal(target, fallback);
        }
        raise_to_front(&mut state, &app_instance_id);
        save_state(&request.storage_root, &state)?;
        return Ok(state);
    }
    state.updated_at = now_string();
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn close_app(request: CloseAppRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    let app_instance_id = normalize_required(&request.app_instance_id, "appInstanceId")?;
    state.open_apps.retain(|entry| entry.id != app_instance_id);
    state.active_app_id = highest_visible_app_id(&state);
    state.updated_at = now_string();
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn move_app_window(request: UpdateWindowFrameRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    state = update_window_frame(state, &request.app_instance_id, request.frame, false)?;
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn resize_app_window(request: UpdateWindowFrameRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    state = update_window_frame(state, &request.app_instance_id, request.frame, true)?;
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn minimize_app(request: WindowActionRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    let app_instance_id = normalize_required(&request.app_instance_id, "appInstanceId")?;
    if let Some(target) = state
        .open_apps
        .iter_mut()
        .find(|entry| entry.id == app_instance_id)
    {
        if target.window_state == WINDOW_NORMAL {
            target.last_normal_frame = Some(target.frame.clone());
        }
        target.window_state = WINDOW_MINIMIZED.to_string();
    }
    state.active_app_id = highest_visible_app_id(&state);
    state.updated_at = now_string();
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn maximize_app(request: WindowActionRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    let app_instance_id = normalize_required(&request.app_instance_id, "appInstanceId")?;
    if let Some(index) = state
        .open_apps
        .iter()
        .position(|entry| entry.id == app_instance_id)
    {
        let target = state.open_apps.get_mut(index).expect("index exists");
        if target.window_state == WINDOW_NORMAL {
            target.last_normal_frame = Some(target.frame.clone());
        } else if target.last_normal_frame.is_none() {
            target.last_normal_frame = Some(create_default_app_frame(&target.kind, index));
        }
        target.window_state = WINDOW_MAXIMIZED.to_string();
        raise_to_front(&mut state, &app_instance_id);
    }
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[napi]
pub fn restore_app(request: WindowActionRequest) -> Result<AiComputerSessionState> {
    let mut state = load_state(&request.storage_root, &request.session_id)?;
    let app_instance_id = normalize_required(&request.app_instance_id, "appInstanceId")?;
    if let Some(index) = state
        .open_apps
        .iter()
        .position(|entry| entry.id == app_instance_id)
    {
        let fallback = create_default_app_frame(&state.open_apps[index].kind, index);
        let target = state.open_apps.get_mut(index).expect("index exists");
        restore_window_to_normal(target, fallback);
        raise_to_front(&mut state, &app_instance_id);
    }
    save_state(&request.storage_root, &state)?;
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_storage_root(label: &str) -> String {
        let path =
            std::env::temp_dir().join(format!("lyra-computer-test-{}-{}", label, now_string()));
        if path.exists() {
            let _ = fs::remove_dir_all(&path);
        }
        path.to_string_lossy().to_string()
    }

    #[test]
    fn reads_default_session() {
        let storage_root = temp_storage_root("default");
        let state = read_session(ReadSessionRequest {
            storage_root,
            session_id: "session-a".to_string(),
        })
        .expect("read default state");
        assert_eq!(state.power_state, POWER_OFF);
        assert!(state.open_apps.is_empty());
    }

    #[test]
    fn powers_on_and_finishes_transition() {
        let storage_root = temp_storage_root("power");
        let booting = power_on_session(PowerRequest {
            storage_root: storage_root.clone(),
            session_id: "session-a".to_string(),
            reason: "ai".to_string(),
        })
        .expect("booting state");
        assert_eq!(booting.power_state, POWER_BOOTING);

        let running = finish_power_transition(FinishPowerTransitionRequest {
            storage_root,
            session_id: "session-a".to_string(),
            target_state: POWER_ON.to_string(),
        })
        .expect("running state");
        assert_eq!(running.power_state, POWER_ON);
    }

    #[test]
    fn opens_focuses_and_restores_windows() {
        let storage_root = temp_storage_root("windows");
        let opened = open_app(OpenAppRequest {
            storage_root: storage_root.clone(),
            session_id: "session-a".to_string(),
            kind: APP_KIND_FILE_EDITOR.to_string(),
            title: None,
            app_instance_id: Some("editor-1".to_string()),
            file_path: Some("/tmp/demo.ts".to_string()),
            directory_path: None,
            address: None,
        })
        .expect("open app");
        assert_eq!(opened.open_apps.len(), 1);
        assert_eq!(opened.active_app_id.as_deref(), Some("editor-1"));
        assert_eq!(opened.open_apps[0].window_state, WINDOW_NORMAL);

        let minimized = minimize_app(WindowActionRequest {
            storage_root: storage_root.clone(),
            session_id: "session-a".to_string(),
            app_instance_id: "editor-1".to_string(),
        })
        .expect("minimize app");
        assert_eq!(minimized.open_apps[0].window_state, WINDOW_MINIMIZED);
        assert_eq!(minimized.active_app_id, None);

        let focused = focus_app(FocusAppRequest {
            storage_root,
            session_id: "session-a".to_string(),
            app_instance_id: "editor-1".to_string(),
        })
        .expect("focus app");
        assert_eq!(focused.active_app_id.as_deref(), Some("editor-1"));
        assert_eq!(focused.open_apps[0].window_state, WINDOW_NORMAL);
    }

    #[test]
    fn opens_multiple_windows_with_explicit_instance_ids() {
        let storage_root = temp_storage_root("multi-instance");

        let first = open_app(OpenAppRequest {
            storage_root: storage_root.clone(),
            session_id: "session-a".to_string(),
            kind: APP_KIND_BROWSER.to_string(),
            title: Some("Browser A".to_string()),
            app_instance_id: Some("browser-1".to_string()),
            file_path: None,
            directory_path: None,
            address: Some("https://example.com".to_string()),
        })
        .expect("open first browser");
        assert_eq!(first.open_apps.len(), 1);
        assert_eq!(first.active_app_id.as_deref(), Some("browser-1"));

        let second = open_app(OpenAppRequest {
            storage_root: storage_root.clone(),
            session_id: "session-a".to_string(),
            kind: APP_KIND_BROWSER.to_string(),
            title: Some("Browser B".to_string()),
            app_instance_id: Some("browser-2".to_string()),
            file_path: None,
            directory_path: None,
            address: Some("https://example.com".to_string()),
        })
        .expect("open second browser");
        assert_eq!(second.open_apps.len(), 2);
        assert_eq!(second.active_app_id.as_deref(), Some("browser-2"));
        assert!(second.open_apps.iter().any(|entry| entry.id == "browser-1"));
        assert!(second.open_apps.iter().any(|entry| entry.id == "browser-2"));
    }

    #[test]
    fn reuses_existing_window_without_explicit_instance_id() {
        let storage_root = temp_storage_root("reuse-implicit");

        let first = open_app(OpenAppRequest {
            storage_root: storage_root.clone(),
            session_id: "session-a".to_string(),
            kind: APP_KIND_TERMINAL.to_string(),
            title: Some("Terminal".to_string()),
            app_instance_id: None,
            file_path: None,
            directory_path: None,
            address: None,
        })
        .expect("open first terminal");
        assert_eq!(first.open_apps.len(), 1);

        let second = open_app(OpenAppRequest {
            storage_root,
            session_id: "session-a".to_string(),
            kind: APP_KIND_TERMINAL.to_string(),
            title: Some("Terminal".to_string()),
            app_instance_id: None,
            file_path: None,
            directory_path: None,
            address: None,
        })
        .expect("open implicit terminal");
        assert_eq!(second.open_apps.len(), 1);
    }

    #[test]
    fn updates_window_frames_and_maximize_restore() {
        let storage_root = temp_storage_root("frame");
        let opened = open_app(OpenAppRequest {
            storage_root: storage_root.clone(),
            session_id: "session-a".to_string(),
            kind: APP_KIND_BROWSER.to_string(),
            title: Some("Browser".to_string()),
            app_instance_id: Some("browser-1".to_string()),
            file_path: None,
            directory_path: None,
            address: Some("https://example.com".to_string()),
        })
        .expect("open browser");
        let initial_frame = opened.open_apps[0].frame.clone();

        let moved = move_app_window(UpdateWindowFrameRequest {
            storage_root: storage_root.clone(),
            session_id: "session-a".to_string(),
            app_instance_id: "browser-1".to_string(),
            frame: AiComputerWindowFrame {
                x: 140.0,
                y: 120.0,
                width: 960.0,
                height: 620.0,
            },
        })
        .expect("move window");
        assert_eq!(moved.open_apps[0].frame.x, 140.0);
        assert_eq!(moved.open_apps[0].frame.width, 960.0);

        let maximized = maximize_app(WindowActionRequest {
            storage_root: storage_root.clone(),
            session_id: "session-a".to_string(),
            app_instance_id: "browser-1".to_string(),
        })
        .expect("maximize window");
        assert_eq!(maximized.open_apps[0].window_state, WINDOW_MAXIMIZED);
        assert!(maximized.open_apps[0].last_normal_frame.is_some());

        let restored = restore_app(WindowActionRequest {
            storage_root,
            session_id: "session-a".to_string(),
            app_instance_id: "browser-1".to_string(),
        })
        .expect("restore window");
        assert_eq!(restored.open_apps[0].window_state, WINDOW_NORMAL);
        assert_ne!(restored.open_apps[0].frame.width, initial_frame.width - 1.0);
    }
}
