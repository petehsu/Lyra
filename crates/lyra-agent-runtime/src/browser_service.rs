#[derive(Clone, Debug, Default)]
pub struct BrowserService;

impl BrowserService {
    pub const NAME: &'static str = "browser_service";

    pub fn list_host_capabilities(&self) -> serde_json::Value {
        serde_json::json!({
            "operators": [
                {
                    "id": "lyra-lumen",
                    "visibleFollow": true,
                    "implicit": true,
                    "feedback": ["cursor", "focus", "hover", "click", "input", "wait"],
                    "selectors": ["selectorMap", "focusScan", "weakDom"],
                    "wait": ["wait", "readUntil"],
                    "visualFallback": true
                }
            ]
        })
    }
}

#[cfg(test)]
mod tests {
    use super::BrowserService;

    #[test]
    fn browser_capabilities_cover_follow_and_implicit_modes() {
        let capabilities = BrowserService::default().list_host_capabilities();
        let operator = &capabilities["operators"][0];
        assert_eq!(operator["visibleFollow"], true);
        assert_eq!(operator["implicit"], true);
        assert!(
            operator["wait"]
                .as_array()
                .expect("wait modes")
                .contains(&"readUntil".into())
        );
    }
}
