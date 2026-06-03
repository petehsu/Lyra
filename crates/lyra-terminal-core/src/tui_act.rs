use crate::screen::TerminalScreenRegion;
use serde::Serialize;

const MAX_SCROLL_REPEAT: u32 = 50;

#[derive(Clone, Debug)]
pub struct TuiActRequest {
    pub action: String,
    pub region_id: Option<String>,
    pub screen_cursor: Option<String>,
    pub text: Option<String>,
    pub direction: Option<String>,
    pub amount: Option<u32>,
    pub reason: Option<String>,
}

pub struct TuiActContext<'a> {
    pub current_screen_cursor: &'a str,
    pub regions: &'a [TerminalScreenRegion],
}

#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TuiActTarget {
    pub region_id: String,
    pub kind: String,
    pub text: String,
    pub row_start: u16,
    pub row_end: u16,
    pub col_start: u16,
    pub col_end: u16,
    pub confidence: f64,
}

#[cfg_attr(feature = "node-api", napi_derive::napi(object))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TuiActPlan {
    pub input_action: String,
    pub keys: Vec<String>,
    pub text: Option<String>,
    pub append_newline: bool,
    pub region_id: Option<String>,
    pub screen_cursor: String,
    pub risk: String,
    pub target: Option<TuiActTarget>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TuiActErrorKind {
    StaleTarget,
    RegionNotFound,
    MissingRegion,
    MissingText,
    UnsupportedAction,
}

#[derive(Clone, Debug)]
pub struct TuiActError {
    pub kind: TuiActErrorKind,
    pub message: String,
}

pub fn resolve_plan(
    context: TuiActContext<'_>,
    request: TuiActRequest,
) -> Result<TuiActPlan, TuiActError> {
    if let Some(cursor) = request.screen_cursor.as_deref().map(str::trim) {
        if !cursor.is_empty() && cursor != context.current_screen_cursor {
            return Err(TuiActError {
                kind: TuiActErrorKind::StaleTarget,
                message: format!(
                    "stale TUI target: requested screen cursor {cursor}, current {}",
                    context.current_screen_cursor
                ),
            });
        }
    }

    let action = normalize_action(&request.action);
    let target = resolve_target(context.regions, request.region_id.as_deref())?;
    let target_view = target.map(target_from_region);
    let region_id = target.map(|region| region.region_id.clone());

    match action.as_str() {
        "select" => {
            let Some(region) = target else {
                return Err(missing_region("select"));
            };
            Ok(plan(
                "selectRegion",
                Vec::new(),
                None,
                false,
                Some(region.region_id.clone()),
                context.current_screen_cursor,
                risk_for_region(region),
                target_view,
                request.reason,
            ))
        }
        "confirm" => Ok(plan(
            "submitInput",
            vec!["enter".to_string()],
            None,
            false,
            region_id,
            context.current_screen_cursor,
            "low",
            target_view,
            request.reason,
        )),
        "cancel" => Ok(plan(
            "pressKeys",
            vec!["escape".to_string()],
            None,
            false,
            region_id,
            context.current_screen_cursor,
            "low",
            target_view,
            request.reason,
        )),
        "toggle" => {
            if target.is_none() {
                return Err(missing_region("toggle"));
            }
            Ok(plan(
                "pressKeys",
                vec!["space".to_string()],
                None,
                false,
                region_id,
                context.current_screen_cursor,
                "low",
                target_view,
                request.reason,
            ))
        }
        "type" => {
            let Some(text) = request.text.filter(|value| !value.is_empty()) else {
                return Err(TuiActError {
                    kind: TuiActErrorKind::MissingText,
                    message: "type action requires text".to_string(),
                });
            };
            Ok(plan(
                "pasteText",
                Vec::new(),
                Some(text),
                false,
                region_id,
                context.current_screen_cursor,
                "shell",
                target_view,
                request.reason,
            ))
        }
        "focus" => {
            let Some(region) = target else {
                return Err(missing_region("focus"));
            };
            Ok(plan(
                "selectRegion",
                Vec::new(),
                None,
                false,
                Some(region.region_id.clone()),
                context.current_screen_cursor,
                "low",
                target_view,
                request.reason,
            ))
        }
        "scroll" => Ok(plan(
            "pressKeys",
            scroll_keys(request.direction.as_deref(), request.amount),
            None,
            false,
            region_id,
            context.current_screen_cursor,
            "low",
            target_view,
            request.reason,
        )),
        "read" => Ok(plan(
            "read",
            Vec::new(),
            None,
            false,
            region_id,
            context.current_screen_cursor,
            "none",
            target_view,
            request.reason,
        )),
        other => Err(TuiActError {
            kind: TuiActErrorKind::UnsupportedAction,
            message: format!("unsupported terminal act action: {other}"),
        }),
    }
}

fn resolve_target<'a>(
    regions: &'a [TerminalScreenRegion],
    region_id: Option<&str>,
) -> Result<Option<&'a TerminalScreenRegion>, TuiActError> {
    let Some(region_id) = region_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    regions
        .iter()
        .find(|region| region.region_id == region_id)
        .map(Some)
        .ok_or_else(|| TuiActError {
            kind: TuiActErrorKind::RegionNotFound,
            message: format!("TUI region not found in current map: {region_id}"),
        })
}

fn missing_region(action: &str) -> TuiActError {
    TuiActError {
        kind: TuiActErrorKind::MissingRegion,
        message: format!("{action} action requires a regionId"),
    }
}

#[allow(clippy::too_many_arguments)]
fn plan(
    input_action: &str,
    keys: Vec<String>,
    text: Option<String>,
    append_newline: bool,
    region_id: Option<String>,
    screen_cursor: &str,
    risk: &str,
    target: Option<TuiActTarget>,
    reason: Option<String>,
) -> TuiActPlan {
    TuiActPlan {
        input_action: input_action.to_string(),
        keys,
        text,
        append_newline,
        region_id,
        screen_cursor: screen_cursor.to_string(),
        risk: risk.to_string(),
        target,
        reason,
    }
}

fn target_from_region(region: &TerminalScreenRegion) -> TuiActTarget {
    TuiActTarget {
        region_id: region.region_id.clone(),
        kind: region.kind.clone(),
        text: region.text.clone(),
        row_start: region.row_start,
        row_end: region.row_end,
        col_start: region.col_start,
        col_end: region.col_end,
        confidence: region.confidence,
    }
}

fn risk_for_region(region: &TerminalScreenRegion) -> &'static str {
    match region.kind.as_str() {
        "link" | "button" | "menu_item" | "checkbox" | "radio" | "selection" => "low",
        "input" | "prompt" => "shell",
        _ => "low",
    }
}

fn normalize_action(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn scroll_keys(direction: Option<&str>, amount: Option<u32>) -> Vec<String> {
    let key = match direction.unwrap_or("down").trim() {
        "up" => "up",
        "left" => "left",
        "right" => "right",
        "pageUp" | "page_up" | "page-up" => "page_up",
        "pageDown" | "page_down" | "page-down" => "page_down",
        _ => "down",
    };
    let count = amount.unwrap_or(1).clamp(1, MAX_SCROLL_REPEAT);
    (0..count).map(|_| key.to_string()).collect()
}
