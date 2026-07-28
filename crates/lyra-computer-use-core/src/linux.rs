//! Linux AT-SPI2 backend.
//!
//! Realizes [`ComputerBackend`] on Linux through AT-SPI2, which is a D-Bus
//! service. Unlike the macOS (FFI) and Windows (COM) backends, the platform API
//! here is fully async (zbus), so this backend bridges to the crate's
//! synchronous trait with [`async_io::block_on`] — no tokio, no global runtime.
//!
//! The `os_ref` scheme is `atspi:<child-index-path>` (e.g. `atspi:0/2/1`),
//! re-walked from the desktop root each call via `get_child_at_index`, exactly
//! like the macOS `osax:` and Windows `uia:` schemes (§6.1): opaque to callers,
//! a concrete path here.
//!
//! Activation uses the AT-SPI Action interface (`do_action` on the index whose
//! name looks like click/press/activate) and EditableText (`set_text_contents`),
//! which act on the object over D-Bus without foreground activation — the
//! semantic, background-friendly path (§0.3). `PasswordText` role maps to a
//! secure node (§11).
//!
//! Compiled only on Linux with `--features linux-atspi`. Not compiled on the
//! macOS dev host; shapes follow atspi 0.30 / atspi-proxies 0.14 signatures
//! verified against the vendored crates, but first real compile + run must be on
//! Linux with an AT-SPI registry present.

#![cfg(all(target_os = "linux", feature = "linux-atspi"))]

use async_io::block_on;
use atspi::connection::AccessibilityConnection;
use atspi::proxy::accessible::{AccessibleProxy, ObjectRefExt};
use atspi::proxy::proxy_ext::ProxyExt;
use atspi::zbus;
use atspi::Role;
use atspi::State;

use crate::backend::ComputerBackend;
use crate::model::{
    ActRequest, BackendError, ComputerAction, ComputerAppEntry, ComputerFocusRequest, ComputerNode,
    ComputerNodeSource, ComputerNodeState, ComputerObserveResult, ComputerWindowEntry,
    ListAppsRequest, MapRequest, MapStrategy, Platform,
};

/// Maps an AT-SPI role to our normalized role vocabulary (shared with the macOS
/// and Windows backends so the Agent sees one set of roles).
fn normalize_role(role: Role) -> &'static str {
    match role {
        Role::Button | Role::ToggleButton => "button",
        Role::Link => "link",
        Role::PasswordText => "securetextbox",
        Role::Entry | Role::Text => "textbox",
        Role::CheckBox => "checkbox",
        Role::RadioButton => "radio",
        Role::MenuItem => "menuitem",
        Role::ComboBox => "combobox",
        Role::Frame | Role::Window => "window",
        Role::ListItem => "listitem",
        Role::Label => "statictext",
        Role::Heading => "heading",
        Role::Image => "image",
        _ => "group",
    }
}

fn actions_for_role(role: &str) -> Vec<ComputerAction> {
    match role {
        "button" | "link" | "menuitem" => vec![ComputerAction::Press, ComputerAction::Focus],
        "textbox" => vec![
            ComputerAction::Focus,
            ComputerAction::SetText,
            ComputerAction::Press,
        ],
        "securetextbox" => vec![ComputerAction::Focus],
        "combobox" => vec![
            ComputerAction::Focus,
            ComputerAction::Press,
            ComputerAction::Select,
        ],
        "checkbox" | "radio" => vec![
            ComputerAction::Focus,
            ComputerAction::Toggle,
            ComputerAction::Press,
        ],
        "listitem" => vec![ComputerAction::Focus, ComputerAction::Select],
        "statictext" | "heading" | "image" => Vec::new(),
        _ => vec![ComputerAction::Focus],
    }
}

fn is_actionable(role: &str) -> bool {
    !actions_for_role(role).is_empty()
}

fn map_err(error: impl std::fmt::Display) -> BackendError {
    BackendError::new("atspiError", error.to_string())
}

/// Connects to the AT-SPI registry. Each backend call opens a connection; this
/// keeps the backend stateless and avoids holding a D-Bus handle across the
/// sync trait boundary.
async fn connect() -> Result<AccessibilityConnection, BackendError> {
    AccessibilityConnection::new().await.map_err(|error| {
        BackendError::new(
            "atspiUnavailable",
            format!("Could not connect to the AT-SPI registry: {error}"),
        )
    })
}

/// The desktop root accessible (the registry's root), used as the stable base
/// for child-index paths.
async fn root_proxy(
    connection: &AccessibilityConnection,
) -> Result<AccessibleProxy<'_>, BackendError> {
    connection
        .root_accessible_on_registry()
        .await
        .map_err(map_err)
}

/// Resolves the Nth child of `parent` to an `AccessibleProxy`, using atspi's
/// canonical `ObjectRef -> proxy` conversion over the same connection. The
/// returned proxy borrows the connection (`'c`), matching what
/// `into_accessible_proxy` yields.
async fn child_at<'c>(
    connection: &'c zbus::Connection,
    parent: &AccessibleProxy<'_>,
    index: i32,
) -> Result<AccessibleProxy<'c>, BackendError> {
    let object = parent.get_child_at_index(index).await.map_err(map_err)?;
    object
        .into_accessible_proxy(connection)
        .await
        .map_err(map_err)
}

async fn read_state(proxy: &AccessibleProxy<'_>, role: &str) -> ComputerNodeState {
    let mut state = ComputerNodeState::default();
    if let Ok(set) = proxy.get_state().await {
        state.enabled = Some(set.contains(State::Enabled) || set.contains(State::Sensitive));
        if role == "checkbox" || role == "radio" {
            state.checked = Some(set.contains(State::Checked));
        }
        state.selected = Some(set.contains(State::Selected));
        state.expanded = Some(set.contains(State::Expanded));
        state.focused = Some(set.contains(State::Focused));
    }
    state
}

async fn node_for_proxy(proxy: &AccessibleProxy<'_>, path: &str) -> ComputerNode {
    let role_enum = proxy.get_role().await.unwrap_or(Role::Unknown);
    let role = normalize_role(role_enum).to_string();
    let secure = role == "securetextbox";
    let name = if secure {
        "Secure input".to_string()
    } else {
        proxy.name().await.unwrap_or_default().trim().to_string()
    };
    let state = read_state(proxy, &role).await;
    let actions = actions_for_role(&role);
    ComputerNode {
        os_ref: format!("atspi:{path}"),
        platform: Platform::Linux,
        app: None,
        window: None,
        role,
        name,
        // AT-SPI never exposes a secure field's contents; non-secure value reads
        // would need the Text interface and are omitted in v1 to keep the tree
        // cheap (D-Bus round-trips are costly).
        value: None,
        bounds: None,
        state,
        actions,
        source: ComputerNodeSource::OsAx,
        secure,
        os_path: path.to_string(),
    }
}

async fn traverse(
    connection: &zbus::Connection,
    proxy: &AccessibleProxy<'_>,
    path: &str,
    request: &MapRequest,
    nodes: &mut Vec<ComputerNode>,
) {
    if nodes.len() >= request.max_nodes {
        return;
    }
    let node = node_for_proxy(proxy, path).await;
    let keep = match request.strategy {
        MapStrategy::Interactive => is_actionable(&node.role) || node.role == "window",
        MapStrategy::Document => !node.name.is_empty() || node.role == "window",
    };
    if keep {
        nodes.push(node);
    }

    let count = proxy.child_count().await.unwrap_or(0);
    for index in 0..count {
        if nodes.len() >= request.max_nodes {
            break;
        }
        if let Ok(child) = child_at(connection, proxy, index).await {
            Box::pin(traverse(
                connection,
                &child,
                &format!("{path}/{index}"),
                request,
                nodes,
            ))
            .await;
        }
    }
}

/// Re-walks a child-index path from the registry root. The returned proxy
/// borrows the connection (`'c`).
async fn resolve_path<'c>(
    connection: &'c zbus::Connection,
    root: AccessibleProxy<'_>,
    os_path: &str,
) -> Option<AccessibleProxy<'c>> {
    let parts = os_path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.first().copied() != Some("0") {
        return None;
    }
    // Walk one level at a time; each step rebuilds a proxy from the child
    // ObjectRef bound to `connection`, so the result does not borrow `root`.
    let mut current = child_at(connection, &root, parts.get(1)?.parse::<i32>().ok()?)
        .await
        .ok()?;
    for part in parts.into_iter().skip(2) {
        let index = part.parse::<i32>().ok()?;
        current = child_at(connection, &current, index).await.ok()?;
    }
    Some(current)
}

fn os_path_from_ref(os_ref: &str) -> Option<&str> {
    os_ref.strip_prefix("atspi:")
}

fn app_ref_for_index(index: usize) -> String {
    format!("atspiapp:{index}")
}

fn window_ref_for_indices(app_index: usize, window_index: usize) -> String {
    format!("atspiwin:{app_index}/{window_index}")
}

fn parse_app_ref(app_ref: &str) -> Option<usize> {
    app_ref.strip_prefix("atspiapp:")?.parse().ok()
}

fn parse_window_ref(window_ref: &str) -> Option<(usize, usize)> {
    let remainder = window_ref.strip_prefix("atspiwin:")?;
    let (app_index, window_index) = remainder.split_once('/')?;
    Some((app_index.parse().ok()?, window_index.parse().ok()?))
}

async fn grab_focus_proxy(proxy: &AccessibleProxy<'_>) -> Result<(), BackendError> {
    let component = proxy
        .proxies()
        .await
        .map_err(map_err)?
        .component()
        .await
        .map_err(map_err)?;
    if component.grab_focus().await.map_err(map_err)? {
        Ok(())
    } else {
        Err(BackendError::new(
            "focusFailed",
            "AT-SPI Component.grab_focus returned false.",
        ))
    }
}

async fn application_at<'c>(
    connection: &'c AccessibilityConnection,
    app_index: usize,
) -> Result<AccessibleProxy<'c>, BackendError> {
    let root = root_proxy(connection).await?;
    child_at(connection.connection(), &root, app_index as i32).await
}

async fn window_at<'c>(
    connection: &'c AccessibilityConnection,
    app_index: usize,
    window_index: usize,
) -> Result<AccessibleProxy<'c>, BackendError> {
    let app = application_at(connection, app_index).await?;
    child_at(connection.connection(), &app, window_index as i32).await
}

async fn list_application_entries(
    connection: &AccessibilityConnection,
    request: &ListAppsRequest,
) -> Result<Vec<ComputerAppEntry>, BackendError> {
    let root = root_proxy(connection).await?;
    let children = root.get_children().await.map_err(map_err)?;
    let mut apps = Vec::new();
    for (app_index, child) in children.into_iter().enumerate() {
        let proxy = child
            .into_accessible_proxy(connection.connection())
            .await
            .map_err(map_err)?;
        let name = proxy.name().await.unwrap_or_default();
        let state = proxy.get_state().await.unwrap_or_default();
        let is_foreground = state.contains(State::Active);
        let mut windows = Vec::new();
        let window_count = proxy.child_count().await.unwrap_or(0);
        for window_index in 0..window_count {
            if let Ok(window_proxy) = child_at(connection.connection(), &proxy, window_index).await
            {
                let role = normalize_role(window_proxy.get_role().await.unwrap_or(Role::Unknown));
                if role != "window" {
                    continue;
                }
                let window_state = read_state(&window_proxy, role).await;
                windows.push(ComputerWindowEntry {
                    window_ref: Some(window_ref_for_indices(app_index, window_index as usize)),
                    title: window_proxy.name().await.unwrap_or_default(),
                    is_focused: window_state.focused.unwrap_or(false),
                });
            }
        }
        if !request.include_background && !is_foreground && windows.is_empty() {
            continue;
        }
        apps.push(ComputerAppEntry {
            app_ref: app_ref_for_index(app_index),
            name,
            pid: None,
            bundle_id: None,
            is_foreground,
            windows,
        });
        if apps.len() >= request.max_apps {
            break;
        }
    }
    apps.sort_by(|left, right| {
        right
            .is_foreground
            .cmp(&left.is_foreground)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(apps)
}

async fn find_focused_control(
    connection: &zbus::Connection,
    proxy: &AccessibleProxy<'_>,
    path: &str,
    depth: usize,
) -> Option<ComputerNode> {
    if depth == 0 {
        return None;
    }
    let state = read_state(proxy, "group").await;
    if state.focused == Some(true) {
        return Some(node_for_proxy(proxy, path).await);
    }
    let count = proxy.child_count().await.unwrap_or(0);
    for index in 0..count {
        if let Ok(child) = child_at(connection, proxy, index).await {
            if let Some(node) = Box::pin(find_focused_control(
                connection,
                &child,
                &format!("{path}/{index}"),
                depth - 1,
            ))
            .await
            {
                return Some(node);
            }
        }
    }
    None
}

/// Activates an object through the AT-SPI Action interface. Picks the action
/// index whose name looks like an activation verb (click/press/activate),
/// falling back to index 0 (the default/primary action).
async fn do_activation(proxy: &AccessibleProxy<'_>) -> Result<(), BackendError> {
    let action = proxy
        .proxies()
        .await
        .map_err(map_err)?
        .action()
        .await
        .map_err(map_err)?;
    let index = action
        .get_actions()
        .await
        .ok()
        .and_then(|actions| {
            actions.iter().position(|entry| {
                let name = entry.name.to_ascii_lowercase();
                name.contains("click") || name.contains("press") || name.contains("activate")
            })
        })
        .map(|index| index as i32)
        .unwrap_or(0);
    action.do_action(index).await.map_err(map_err).map(|_| ())
}

async fn do_set_text(proxy: &AccessibleProxy<'_>, text: &str) -> Result<(), BackendError> {
    let editable = proxy
        .proxies()
        .await
        .map_err(map_err)?
        .editable_text()
        .await
        .map_err(map_err)?;
    editable
        .set_text_contents(text)
        .await
        .map_err(map_err)
        .map(|_| ())
}

/// The Linux AT-SPI2 [`ComputerBackend`].
pub struct LinuxBackend;

impl LinuxBackend {
    pub fn new() -> Self {
        LinuxBackend
    }
}

impl Default for LinuxBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl ComputerBackend for LinuxBackend {
    fn is_available(&self) -> bool {
        block_on(async { connect().await.is_ok() })
    }

    fn map(&self, request: &MapRequest) -> Result<Vec<ComputerNode>, BackendError> {
        block_on(async {
            let connection = connect().await?;
            let root = root_proxy(&connection).await?;
            let mut nodes = Vec::new();
            traverse(connection.connection(), &root, "0", request, &mut nodes).await;
            Ok(nodes)
        })
    }

    fn resolve(&self, os_ref: &str) -> Result<Option<ComputerNode>, BackendError> {
        let Some(os_path) = os_path_from_ref(os_ref) else {
            return Err(BackendError::new(
                "invalidOsRef",
                "Computer osRef must use the atspi: scheme on Linux.",
            ));
        };
        block_on(async {
            let connection = connect().await?;
            let root = root_proxy(&connection).await?;
            match resolve_path(connection.connection(), root, os_path).await {
                Some(proxy) => Ok(Some(node_for_proxy(&proxy, os_path).await)),
                None => Ok(None),
            }
        })
    }

    fn act(&self, request: &ActRequest) -> Result<(), BackendError> {
        let Some(os_path) = os_path_from_ref(&request.os_ref) else {
            return Err(BackendError::new(
                "invalidOsRef",
                "Computer osRef must use the atspi: scheme on Linux.",
            ));
        };
        block_on(async {
            let connection = connect().await?;
            let root = root_proxy(&connection).await?;
            let proxy = resolve_path(connection.connection(), root, os_path)
                .await
                .ok_or_else(|| {
                    BackendError::stale_os_ref(
                        "Computer osRef is no longer present in the accessibility tree.",
                    )
                })?;
            match request.action {
                ComputerAction::SetText => {
                    do_set_text(&proxy, request.text.as_deref().unwrap_or_default()).await
                }
                ComputerAction::Focus => {
                    // grab_focus lives on the Component interface; activation via
                    // Action is the portable path, so fall back to it.
                    do_activation(&proxy).await
                }
                // typeText / pressKey / secondaryAction / drag require
                // keyboard-event or coordinate synthesis not yet wired through
                // AT-SPI. Return structured unsupported.
                ComputerAction::TypeText
                | ComputerAction::PressKey
                | ComputerAction::SecondaryAction
                | ComputerAction::Drag => Err(BackendError::unsupported(format!(
                    "Action {:?} is not yet implemented on the Linux AT-SPI backend.",
                    request.action.as_str()
                ))),
                // Press / Toggle / Select / Scroll all route through the Action
                // interface in AT-SPI: the object exposes the relevant verb.
                _ => do_activation(&proxy).await,
            }
        })
    }

    fn list_apps(&self, request: &ListAppsRequest) -> Result<Vec<ComputerAppEntry>, BackendError> {
        block_on(async {
            let connection = connect().await?;
            list_application_entries(&connection, request).await
        })
    }

    fn observe(&self) -> Result<ComputerObserveResult, BackendError> {
        block_on(async {
            let connection = connect().await?;
            let apps = list_application_entries(
                &connection,
                &ListAppsRequest {
                    max_apps: 100,
                    include_background: true,
                },
            )
            .await?;
            let foreground_app = apps.iter().find(|app| app.is_foreground).cloned();
            let focused_window = foreground_app.as_ref().and_then(|app| {
                app.windows
                    .iter()
                    .find(|window| window.is_focused)
                    .or_else(|| app.windows.first())
                    .cloned()
            });
            let focused_control = if let Some(app_index) = foreground_app
                .as_ref()
                .and_then(|app| parse_app_ref(&app.app_ref))
            {
                application_at(&connection, app_index)
                    .await
                    .ok()
                    .and_then(|app| {
                        Box::pin(find_focused_control(
                            connection.connection(),
                            &app,
                            &format!("0/{app_index}"),
                            5,
                        ))
                        .await
                    })
            } else {
                None
            };
            Ok(ComputerObserveResult {
                foreground_app,
                focused_window,
                focused_control,
            })
        })
    }

    fn focus(&self, request: &ComputerFocusRequest) -> Result<(), BackendError> {
        block_on(async {
            let connection = connect().await?;
            if request.bundle_id.is_some() || request.pid.is_some() {
                return Err(BackendError::new(
                    "unsupported",
                    "pid/bundleId focus is not implemented on Linux; use appRef, windowRef, or windowTitle.",
                ));
            }
            if let Some(window_ref) = request.window_ref.as_deref() {
                let Some((app_index, window_index)) = parse_window_ref(window_ref) else {
                    return Err(BackendError::new(
                        "invalidArgument",
                        "windowRef must use the atspiwin:<appIndex>/<windowIndex> scheme on Linux.",
                    ));
                };
                let window = window_at(&connection, app_index, window_index).await?;
                return grab_focus_proxy(&window).await;
            }
            if let Some(title) = request.window_title.as_deref() {
                let apps = list_application_entries(
                    &connection,
                    &ListAppsRequest {
                        max_apps: 100,
                        include_background: true,
                    },
                )
                .await?;
                for app in &apps {
                    if let Some((app_index, window_index)) = app
                        .windows
                        .iter()
                        .enumerate()
                        .find(|(_, window)| window.title == title)
                        .and_then(|(window_index, window)| {
                            window
                                .window_ref
                                .as_deref()
                                .and_then(parse_window_ref)
                                .or(Some((parse_app_ref(&app.app_ref)?, window_index)))
                        })
                    {
                        let window = window_at(&connection, app_index, window_index).await?;
                        return grab_focus_proxy(&window).await;
                    }
                }
                return Err(BackendError::new(
                    "windowNotFound",
                    format!("No window titled {title:?} was found."),
                ));
            }
            let app_index = if let Some(app_ref) = request.app_ref.as_deref() {
                parse_app_ref(app_ref).ok_or_else(|| {
                    BackendError::new(
                        "invalidArgument",
                        "appRef must use the atspiapp:<index> scheme on Linux.",
                    )
                })?
            } else {
                return Err(BackendError::new(
                    "invalidArgument",
                    "computer.focus requires appRef, windowRef, or windowTitle on Linux.",
                ));
            };
            let app = application_at(&connection, app_index).await?;
            grab_focus_proxy(&app).await
        })
    }
}
