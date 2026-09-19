use serde_json::{json, Value};

use crate::model::ToolManifest;
use crate::schema::object_schema;

struct ComputerOs {
    os_ref: &'static str,
    app_ref: &'static str,
    window_ref: &'static str,
    actions: &'static [&'static str],
    press_key_example: Option<&'static str>,
    secondary_example: Option<&'static str>,
}

#[cfg(target_os = "macos")]
fn computer_os() -> Option<ComputerOs> {
    Some(ComputerOs {
        os_ref: "osax:<path>",
        app_ref: "osxapp:<pid>",
        window_ref: "osxwin:<pid>/<index>",
        actions: &[
            "press",
            "focus",
            "setText",
            "typeText",
            "toggle",
            "select",
            "scroll",
            "pressKey",
            "secondaryAction",
            "drag",
        ],
        press_key_example: Some("cmd+c"),
        secondary_example: Some("AXShowMenu"),
    })
}

#[cfg(windows)]
fn computer_os() -> Option<ComputerOs> {
    Some(ComputerOs {
        os_ref: "uia:<path>",
        app_ref: "winapp:<pid>",
        window_ref: "winwin:<hwnd>",
        actions: &[
            "press",
            "focus",
            "setText",
            "typeText",
            "toggle",
            "select",
            "scroll",
            "pressKey",
            "secondaryAction",
            "drag",
        ],
        press_key_example: Some("ctrl+c"),
        secondary_example: Some("ShowMenu / AXShowMenu"),
    })
}

#[cfg(target_os = "linux")]
fn computer_os() -> Option<ComputerOs> {
    Some(ComputerOs {
        os_ref: "atspi:<path>",
        app_ref: "atspiapp:<index>",
        window_ref: "atspiwin:<appIndex>/<windowIndex>",
        actions: &["press", "focus", "setText", "toggle", "select", "scroll"],
        press_key_example: None,
        secondary_example: None,
    })
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn computer_os() -> Option<ComputerOs> {
    None
}

fn string(description: &str) -> Value {
    json!({ "type": "string", "description": description })
}

pub(super) fn manifests() -> Vec<ToolManifest> {
    let Some(os) = computer_os() else {
        return Vec::new();
    };
    vec![
        super::s(
            "/tools/computer/list_apps",
            "computer",
            "list_apps",
            "List desktop applications",
            "List running native desktop applications and their visible windows, including the foreground app. Does not include Lyra browser, terminal, or file-manager tabs.",
            Some("computer_list_apps"),
        ),
        super::s(
            "/tools/computer/observe",
            "computer",
            "observe",
            "Observe desktop foreground state",
            "Read the foreground native application, focused window, and focused accessibility control without mapping the full tree. Does not report Lyra workbench tabs as the desktop foreground.",
            Some("computer_observe"),
        ),
        super::s(
            "/tools/computer/focus",
            "computer",
            "focus",
            "Focus desktop application or window",
            "Raise a native desktop app or window to the foreground (session-level focus). Distinct from computer.act(action: focus) which targets a single accessibility node. Shared mode only — background/isolated sessions refuse foreground steal. Does not switch Lyra tabs.",
            None,
        ),
        super::s(
            "/tools/computer/map",
            "computer",
            "map",
            "Map computer accessibility tree",
            &format!(
                "Read the focused native app's accessibility tree ({}) for semantic, non-visual control. Does not operate Lyra browser, terminal, or file-manager tabs.",
                os.os_ref
            ),
            Some("computer_map"),
        ),
        super::s(
            "/tools/computer/find",
            "computer",
            "find",
            "Find computer accessibility node",
            "Find native desktop nodes by role and name within a fresh accessibility snapshot, returning osRefs.",
            Some("computer_find"),
        ),
        super::s(
            "/tools/computer/act",
            "computer",
            "act",
            "Act on computer node",
            &act_summary(&os),
            None,
        ),
        super::s(
            "/tools/computer/diff",
            "computer",
            "diff",
            "Diff computer accessibility state",
            "Re-read a native desktop node by osRef, or compute the observation diff (added/removed/changed) against an earlier computer.map snapshot.",
            Some("computer_diff"),
        ),
        super::s(
            "/tools/computer/explain",
            "computer",
            "explain",
            "Explain computer node",
            "Explain whether semantic OS control is available, whether an osRef is still resolvable, and the recommended next path.",
            Some("computer_explain"),
        ),
        super::s(
            "/tools/computer/see",
            "computer",
            "see",
            "Capture desktop screenshot",
            "Visual fallback (Level 3): screenshot the screen or focused native window so the model can read UI that has no accessibility node. Pure observation — does not steal focus or act. Use only after computer.map/explain shows semantic control cannot reach the target. Do not use this for Lyra browser pages.",
            Some("computer_see"),
        ),
    ]
}

fn act_summary(os: &ComputerOs) -> String {
    let actions = os.actions.join("/");
    let mut extra = String::new();
    if let Some(example) = os.press_key_example {
        extra.push_str(&format!(" pressKey sends key combinations (e.g. {example})."));
    }
    if let Some(example) = os.secondary_example {
        extra.push_str(&format!(
            " secondaryAction invokes a non-primary accessibility action (e.g. {example})."
        ));
    }
    format!(
        "Press, focus, set text, or otherwise act on a native desktop node by osRef ({}); returns a before/after diff. Supported actions on this OS: {actions}.{extra}",
        os.os_ref
    )
}

pub(super) fn examples(operation: &str) -> Vec<&'static str> {
    if computer_os().is_none() {
        return Vec::new();
    }
    match operation {
        "list_apps" | "observe" => {
            #[cfg(target_os = "linux")]
            {
                vec![
                    "List running desktop apps to find Files before computer.map.",
                    "列出正在运行的桌面应用,在 computer.map 之前找到文件管理器。",
                ]
            }
            #[cfg(target_os = "macos")]
            {
                vec![
                    "List running desktop apps to find Finder before computer.map.",
                    "列出正在运行的桌面应用,在 computer.map 之前找到 Finder。",
                ]
            }
            #[cfg(windows)]
            {
                vec![
                    "List running desktop apps to find File Explorer before computer.map.",
                    "列出正在运行的桌面应用,在 computer.map 之前找到文件资源管理器。",
                ]
            }
            #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
            {
                Vec::new()
            }
        }
        "focus" => vec![
            "Bring System Settings to the foreground before mapping its accessibility tree.",
            "在映射无障碍树之前把「系统设置」切到前台。",
        ],
        "map" | "find" | "explain" => vec![
            "Read the focused app's accessibility tree to locate its New Folder button.",
            "读取前台应用的无障碍树,定位它的「新建文件夹」按钮。",
        ],
        "act" | "diff" => vec![
            "Toggle a checkbox in System Settings by osRef, then read back its state.",
            "用 osRef 勾选系统设置里的开关,再回读它的状态确认生效。",
        ],
        "see" => vec![
            "Screenshot the focused window to read a canvas-drawn chart that has no accessibility node.",
            "截图前台窗口,读取没有无障碍节点的 canvas 图表内容。",
        ],
        _ => Vec::new(),
    }
}

pub(super) fn purpose(operation: &str) -> Option<&'static str> {
    computer_os()?;
    Some(match operation {
        "list_apps" | "observe" => {
            "Use before driving an external native app to see what is running and which app/window/control has focus. computer.list_apps enumerates native apps and windows; computer.observe returns the current foreground native app, focused window, and focused control without mapping the full tree. Do not use these to inspect Lyra tabs."
        }
        "focus" => {
            "Use to switch the member's desktop to a specific native app or window (session-level foreground focus). Distinct from computer.act(action: focus), which only moves accessibility focus to one control. Requires shared mode; background/isolated sessions refuse foreground steal. Do not use this to activate a Lyra tab."
        }
        "map" | "find" | "explain" => map_purpose(),
        "act" | "diff" => act_purpose(),
        "see" => {
            "Use only as a visual fallback when semantic control of a native OS app fails. Screenshots the screen or the frontmost app window. Do not use this to inspect a Lyra browser page; use /tools/workbench/capture_visual_evidence or /tools/browser/see."
        }
        _ => return None,
    })
}

fn map_purpose() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        "Use to control native desktop apps outside Lyra through Linux AT-SPI (osRef atspi:<path>): read the focused window's semantic tree, find a control by role/name, or explain whether semantic control is available. Prefer this over screenshots. Browser, terminal, and file-manager tabs have their own tools."
    }
    #[cfg(target_os = "macos")]
    {
        "Use to control native desktop apps outside Lyra through macOS Accessibility (osRef osax:<path>): read the focused window's semantic tree, find a control by role/name, or explain whether semantic control is available. Prefer this over screenshots. Browser, terminal, and file-manager tabs have their own tools."
    }
    #[cfg(windows)]
    {
        "Use to control native desktop apps outside Lyra through Windows UI Automation (osRef uia:<path>): read the focused window's semantic tree, find a control by role/name, or explain whether semantic control is available. Prefer this over screenshots. Browser, terminal, and file-manager tabs have their own tools."
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        "Computer Use is not available on this OS."
    }
}

fn act_purpose() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        "Use when an osRef from computer.map/find is the right native desktop target. Linux AT-SPI supports press/focus/setText/toggle/select/scroll. computer.act returns a before/after diff; computer.diff re-reads one node or diffs a whole snapshot. Do not send pressKey, typeText, secondaryAction, or drag — they are not implemented on this OS."
    }
    #[cfg(target_os = "macos")]
    {
        "Use when an osRef from computer.map/find is the right native desktop target: press/focus/setText/typeText/toggle/select/scroll/pressKey/secondaryAction it semantically (no coordinates except drag), or verify with computer.diff. typeText types via keyboard events; setText replaces the whole value. pressKey sends combinations such as cmd+c. secondaryAction invokes non-primary AX actions (e.g. AXShowMenu). drag is shared mode only."
    }
    #[cfg(windows)]
    {
        "Use when an osRef from computer.map/find is the right native desktop target: press/focus/setText/typeText/toggle/select/scroll/pressKey/secondaryAction it semantically (no coordinates except drag), or verify with computer.diff. typeText types via keyboard events; setText replaces the whole value. pressKey sends combinations such as ctrl+c. secondaryAction maps to UIA primitives (e.g. AXShowMenu for a context menu). drag is shared mode only."
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        "Computer Use is not available on this OS."
    }
}

pub(super) fn domain_summary() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        "Control native Linux desktop apps through AT-SPI (osRef atspi:): map, find, act, and verify semantically. Does not operate Lyra browser, terminal, or files tabs."
    }
    #[cfg(target_os = "macos")]
    {
        "Control native macOS desktop apps through Accessibility (osRef osax:): map, find, act, and verify semantically. Does not operate Lyra browser, terminal, or files tabs."
    }
    #[cfg(windows)]
    {
        "Control native Windows desktop apps through UI Automation (osRef uia:): map, find, act, and verify semantically. Does not operate Lyra browser, terminal, or files tabs."
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        "Native desktop computer tools are not available on this OS."
    }
}

pub(super) fn input_schema(operation: &str) -> Value {
    let Some(os) = computer_os() else {
        return json!({ "type": "object", "properties": {} });
    };
    match operation {
        "list_apps" => object_schema(
            [
                (
                    "maxApps",
                    json!({ "type": "integer", "minimum": 1, "maximum": 100, "default": 50, "description": "Cap on returned desktop apps." }),
                ),
                (
                    "includeBackground",
                    json!({ "type": "boolean", "default": false, "description": "Include apps without a visible/focused window." }),
                ),
            ],
            &[],
        ),
        "observe" => object_schema([], &[]),
        "focus" => focus_schema(&os),
        "map" => object_schema(
            [
                (
                    "strategy",
                    json!({ "type": "string", "enum": ["interactive", "document"], "default": "interactive", "description": "interactive: actionable controls only; document: include text/headings for reading structure." }),
                ),
                (
                    "maxNodes",
                    json!({ "type": "integer", "minimum": 1, "maximum": 400, "default": 200, "description": "Cap on returned desktop nodes to prevent tree explosion." }),
                ),
            ],
            &[],
        ),
        "find" => object_schema(
            [
                (
                    "role",
                    string("Desktop role to match, e.g. button, textbox, checkbox, menuitem."),
                ),
                (
                    "nameIncludes",
                    string("Substring the accessible name must contain (case-insensitive)."),
                ),
                (
                    "strategy",
                    json!({ "type": "string", "enum": ["interactive", "document"], "default": "interactive" }),
                ),
                (
                    "maxResults",
                    json!({ "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }),
                ),
            ],
            &[],
        ),
        "act" => act_schema(&os),
        "diff" => object_schema(
            [
                (
                    "baselineSnapshotId",
                    string(
                        "snapshotId from a prior computer.map/find. When set, returns the observation diff (added/removed/changed) against a fresh read.",
                    ),
                ),
                (
                    "osRef",
                    string(&format!(
                        "Native desktop node reference ({}) to re-read for single-node verification. Used when baselineSnapshotId is absent.",
                        os.os_ref
                    )),
                ),
                (
                    "strategy",
                    json!({ "type": "string", "enum": ["interactive", "document"], "default": "interactive", "description": "Strategy for the fresh read in a snapshot diff." }),
                ),
                (
                    "maxNodes",
                    json!({ "type": "integer", "minimum": 1, "maximum": 400, "default": 200 }),
                ),
            ],
            &[],
        ),
        "explain" => object_schema(
            [(
                "osRef",
                string("Optional native desktop node reference to check for reachability."),
            )],
            &[],
        ),
        "see" => object_schema(
            [
                (
                    "scope",
                    json!({ "type": "string", "enum": ["screen", "focused-window"], "default": "focused-window", "description": "screen: full primary display. focused-window: only the frontmost native app window." }),
                ),
                (
                    "downsampleForVision",
                    json!({ "type": "boolean", "default": true, "description": "Downsample to <=2000px longest edge before returning the vision artifact." }),
                ),
            ],
            &[],
        ),
        _ => json!({ "type": "object", "properties": {} }),
    }
}

fn focus_schema(os: &ComputerOs) -> Value {
    let app_ref = string(&format!(
        "Opaque app reference from computer.list_apps ({}).",
        os.app_ref
    ));
    let window_title = string("Exact window title to raise when appRef is unknown.");
    let window_ref = string(&format!(
        "Opaque window reference from computer.list_apps ({}).",
        os.window_ref
    ));
    let mode = json!({ "type": "string", "enum": ["shared", "background-semantic", "isolated-session"], "default": "shared", "description": "shared only: computer.focus refuses foreground steal in background/isolated modes." });
    #[cfg(target_os = "linux")]
    {
        object_schema(
            [
                ("appRef", app_ref),
                ("windowTitle", window_title),
                ("windowRef", window_ref),
                ("mode", mode),
            ],
            &[],
        )
    }
    #[cfg(any(target_os = "macos", windows))]
    {
        object_schema(
            [
                ("appRef", app_ref),
                (
                    "pid",
                    json!({ "type": "integer", "description": "Process id when appRef is unknown." }),
                ),
                ("windowTitle", window_title),
                ("windowRef", window_ref),
                ("mode", mode),
            ],
            &[],
        )
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = (os, app_ref, window_title, window_ref, mode);
        json!({ "type": "object", "properties": {} })
    }
}

fn act_schema(os: &ComputerOs) -> Value {
    let os_ref = string(&format!(
        "Native desktop node reference from computer.map/find ({}). Not an axRef, targetRef, or Lyra tab id.",
        os.os_ref
    ));
    let action = json!({
        "type": "string",
        "enum": os.actions,
        "default": "press"
    });
    let effect = super::browser_action_effect_schema();
    let text = string(
        "Plaintext payload for setText or typeText. Never use this for passwords — pass sensitiveValueRef instead.",
    );
    let sensitive = json!({ "type": "object", "description": "A lyra-sensitive-value-ref (from the login manager / sensitive-values store) to autofill into a setText target. The plaintext is resolved host-side and never enters the model; this is the only sanctioned way to fill a secure (password) field." });
    let mode = json!({ "type": "string", "enum": ["shared", "background-semantic", "isolated-session"], "default": "shared", "description": "shared: user-visible, focus/raise allowed. background-semantic/isolated-session: true background, semantic actions only — focus/raise is refused." });
    let direction = json!({ "type": "string", "enum": ["up", "down", "left", "right"], "description": "Scroll direction. Used with action: scroll." });
    let pages = json!({ "type": "number", "minimum": 0.1, "description": "Scroll pages (fractional supported, e.g. 0.5). Used with action: scroll. Defaults to 1." });
    if os.press_key_example.is_none() {
        return object_schema(
            [
                ("osRef", os_ref),
                ("action", action),
                ("effect", effect),
                ("text", text),
                ("sensitiveValueRef", sensitive),
                ("mode", mode),
                ("direction", direction),
                ("pages", pages),
            ],
            &["osRef"],
        );
    }
    object_schema(
        [
            ("osRef", os_ref),
            ("action", action),
            ("effect", effect),
            ("text", text),
            ("sensitiveValueRef", sensitive),
            ("mode", mode),
            (
                "key",
                json!({ "type": "string", "description": format!("Key specification for pressKey (e.g. {}). Required when action is pressKey.", os.press_key_example.unwrap_or("return")) }),
            ),
            (
                "actionName",
                json!({ "type": "string", "description": format!("Secondary accessibility action name for secondaryAction (e.g. {:?}). Required when action is secondaryAction.", os.secondary_example.unwrap_or("ShowMenu")) }),
            ),
            ("direction", direction),
            ("pages", pages),
            (
                "fromX",
                json!({ "type": "number", "description": "Drag start X (screen-space pixels). Used with action: drag." }),
            ),
            (
                "fromY",
                json!({ "type": "number", "description": "Drag start Y (screen-space pixels). Used with action: drag." }),
            ),
            (
                "toX",
                json!({ "type": "number", "description": "Drag end X (screen-space pixels). Used with action: drag." }),
            ),
            (
                "toY",
                json!({ "type": "number", "description": "Drag end Y (screen-space pixels). Used with action: drag." }),
            ),
        ],
        &["osRef"],
    )
}
