use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/browser/reload",
            "browser",
            "reload",
            "Reload browser page",
            "Reload the current task tab, optionally bypassing cache. Preserve tab identity; do not reload an in-progress form merely to refresh its map.",
            Some("browser_reload"),
        ),
        super::s(
            "/tools/browser/dialog",
            "browser",
            "dialog",
            "Handle pending native browser dialog",
            "Accept or dismiss a pending native alert/confirm/prompt using its dialogId. Read the returned message first. Accept must retain the triggering action's effect. Never replay the original click. Never invent dialogId or treat a DOM lookalike panel as a native dialog.",
            Some("browser_dialog"),
        ),
        super::s(
            "/tools/browser/drag",
            "browser",
            "drag",
            "Drag between mapped browser targets",
            "Drag using two real DOM targetRefs, optionally fractional endpoint positions within their live bounds. Supports pointer-driven sliders/splitters and native HTML drag/drop. No screenshot coordinates. Endpoint frames are resolved from their identities; inspect the returned state before claiming completion.",
            Some("browser_drag"),
        ),
        super::s(
            "/tools/browser/upload",
            "browser",
            "upload",
            "Select browser upload files",
            "Select explicit local files in the webpage without a system dialog. Pass the mapped attachment button/input targetRef to click and select in one call, or chooserId from a pending selection. The webpage performs the upload; verify its attachment/progress/error state. Never repeat an uncertain upload automatically.",
            Some("browser_upload"),
        ),
        super::s(
            "/tools/browser/map",
            "browser",
            "map",
            "Map browser page",
            "Read a short map backed by the complete observed control index. Focused regions and forms appear first. Retrieve omitted controls using query/region/cursor; no link is excluded for seeming unimportant. Control lines collapse label and icon into one actionable targetRef, plus read-only dialog/error/status/focus context. Refs stay valid while controls persist and a layout shift re-locates at click time; 'no longer mapped' means covered or hidden, not deleted — detached-node events identify real removal. DOM ancestors identify rows, overlap does not; unknown state is not off and class names are not confirmed state.",
            Some("browser_map"),
        ),
        super::s(
            "/tools/browser/read",
            "browser",
            "read",
            "Read browser page",
            "Read rendered page text or search it with query (Ctrl+F). instruction/schema are interpretation hints only: this tool does not execute them, extract arbitrary HTML attributes, or apply a JSON schema. query does not retrieve a field by its name; use browser_map(query) for named controls.",
            Some("browser_read"),
        ),
        super::s(
            "/tools/browser/see",
            "browser",
            "see",
            "See browser page",
            "See the current page with thin real-object boxes and stable short marks. Use a region mark for a close view; crowded pages return nextOffset. Marks share the nonvisual control registry; canvas regions still require visual interpretation.",
            None,
        ),
        super::s(
            "/tools/browser/detect_qr",
            "browser",
            "detect_qr",
            "Detect browser QR codes",
            "Capture the current browser viewport and detect QR codes with device-pixel bounds, optional QR-only crops, and vact-compatible captureId.",
            None,
        ),
        super::s(
            "/tools/browser/act",
            "browser",
            "act",
            "Act in browser",
            "Click, hover, or select a mapped target. Use modifiers/button/holdMs for real pointer gestures; position is a fraction within the target. Native selects without a choice return a bounded option list (optionQuery/optionOffset); no OS popup. To choose, supply exact optionLabel, selectValue or selectValues; ambiguous options are rejected. interaction=click is the gesture; effect is its consequence, never click. Specify interaction explicitly; hover+observe inspects without clicking. Example: {targetRef: 'lumen:…', interaction: 'click', effect: 'editDraft'} opens a local menu. Sending uses communicate or submitExternal; deleting uses delete. Off-screen refs scroll into view. The receipt names the acted control with resulting controls and context; updated control lines replace earlier facts including cleared errors. surfaceChange covers the whole surface, elementDiff only the acted node — an unchanged clicked node does not contradict a newly opened menu.",
            Some("browser_act"),
        ),
        super::s(
            "/tools/browser/vact",
            "browser",
            "vact",
            "Visually act in browser",
            "Act by screenshot mark using real object references. Supports typing, keys/holds, continuous drag paths, scrolling and explicit sequences. position is relative within a mark; raw point is image pixels. Returns the resulting marked image when needed, without another see call. Never replay completed steps.",
            None,
        ),
        super::s(
            "/tools/browser/type",
            "browser",
            "type",
            "Type in browser",
            "Type at the current caret/selection, or fill several fields. Use clear=true to replace the whole field; omission preserves existing content. When input and submit targets are already known, use thenClick to fill and submit once in this call; when the task needs a reply, set awaitResponse=true to receive it without another model round trip; declare the submit effect (communicate, submitExternal, etc.); editDraft is invalid for submission. Use a separate act for a local UI click. Without thenClick use effect=editDraft. A split row of boxes takes one string. The receipt reports inputValuePreview and inputEvidence for the live value and verification — a missing observed input event alone does not mean text was rejected. Live dispatch revalidates known refs without rebuilding the map, so reuse input and submit refs for repeated messages.",
            Some("browser_type"),
        ),
        super::s(
            "/tools/browser/press",
            "browser",
            "press",
            "Press browser key",
            "Press a key/shortcut while preserving caret and selection. selectText selects a unique phrase in targetRef before the key (e.g. Control+b to bold it); repeat batches navigation/selection keys. Returned editor state reports the selection and native format state.",
            None,
        ),
        super::s(
            "/tools/browser/scroll",
            "browser",
            "scroll",
            "Scroll browser page",
            "Scroll the viewport when the surface map says controls remain outside this window, or when a feed has no targetRef.",
            Some("browser_scroll"),
        ),
        super::s(
            "/tools/browser/wait",
            "browser",
            "wait",
            "Wait browser",
            "Wait for a specific page condition and return text, reading coverage, control states, a paged map, matched/completion and stopReason; matched=false means the condition was not established, and stopReason=navigationChanged returns the superseded ready destination instead of the guessed text. The text fingerprint covers the full scanned document, so a viewport or budgeted scan cannot prove stability. For a tracked send use responseComplete; observation began at the send and survives model round trips. Map after navigation; never guess or translate the page's expected labels. Prefer an observed stop control becoming hidden or a ready control becoming enabled. Quiet text alone does not prove completion. Reuse returned text.",
            None,
        ),
        super::s(
            "/tools/browser/navigate",
            "browser",
            "navigate",
            "Navigate browser",
            "Open a URL (Google search, GitHub, documentation or other websites) in another task tab by default, preserving existing forms and verification flows. To replace a page deliberately, specify its tabId. Return to a preserved tab with map(tabId); foreground focus does not change the task target.",
            None,
        ),
        super::s(
            "/tools/browser/elevate",
            "browser",
            "elevate",
            "Elevate browser task",
            "Elevate an isolated browser task.",
            None,
        ),
    ]
}

pub(super) fn drag_schema() -> serde_json::Value {
    use serde_json::json;
    let point = json!({"type":"object","properties":{"x":{"type":"number","minimum":0,"maximum":1},"y":{"type":"number","minimum":0,"maximum":1}},"required":["x","y"],"additionalProperties":false});
    super::object_schema(
        [
            ("tabId", super::browser_tab_id_schema()),
            ("targetMode", super::browser_target_mode_schema()),
            (
                "targetRef",
                json!({"type":"string","description":"Source DOM targetRef."}),
            ),
            (
                "toTargetRef",
                json!({"type":"string","description":"Destination DOM targetRef. May equal source for a stable slider track; choose a stable destination for moving handles."}),
            ),
            ("fromPosition", point.clone()),
            ("toPosition", point),
            (
                "modifiers",
                json!({"type":"array","items":{"type":"string","enum":["shift","control","alt","meta"]},"uniqueItems":true}),
            ),
            ("effect", super::browser_action_effect_schema()),
        ],
        &["targetRef", "toTargetRef", "effect"],
    )
}

pub(super) fn dialog_schema() -> serde_json::Value {
    use serde_json::json;
    super::object_schema(
        [
            ("tabId", super::browser_tab_id_schema()),
            ("targetMode", super::browser_target_mode_schema()),
            (
                "dialogId",
                json!({"type":"string","description":"Exact pending dialog ID returned by the triggering action."}),
            ),
            ("accept", json!({"type":"boolean"})),
            (
                "promptText",
                json!({"type":"string","description":"Literal prompt answer; only for a prompt dialog."}),
            ),
            ("effect", super::browser_action_effect_schema()),
        ],
        &["dialogId", "accept", "effect"],
    )
}
