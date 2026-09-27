// Browser calls share focus, selection, tabs and a target registry. They must
// follow model order even when unrelated tools in the same batch run in parallel.
// Tickets release on drop, including cancellation/panic, under the batch deadline.
#[derive(Default)]
pub(super) struct BrowserBatchOrder {
    previous: Option<tokio::sync::oneshot::Receiver<()>>,
}

pub(super) struct BrowserTurn {
    previous: Option<tokio::sync::oneshot::Receiver<()>>,
    _completion: Option<tokio::sync::oneshot::Sender<()>>,
}

impl BrowserBatchOrder {
    pub(super) fn reserve(&mut self, browser: bool) -> BrowserTurn {
        if !browser {
            return BrowserTurn {
                previous: None,
                _completion: None,
            };
        }
        let (send, receive) = tokio::sync::oneshot::channel();
        BrowserTurn {
            previous: self.previous.replace(receive),
            _completion: Some(send),
        }
    }
}

impl BrowserTurn {
    pub(super) async fn enter(mut self) -> Self {
        if let Some(previous) = self.previous.take() {
            let _ = previous.await;
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_backend::tool_protocol::is_browser_tool_name;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn browser_input_and_observation_follow_model_order_while_other_tools_run() {
        let mut order = BrowserBatchOrder::default();
        let first = order
            .reserve(is_browser_tool_name("browser_press"))
            .enter()
            .await;
        let second = order.reserve(is_browser_tool_name("browser_type"));
        let third = order.reserve(is_browser_tool_name("browser_map"));
        let independent = order.reserve(is_browser_tool_name("ToolSearch"));
        let log = Arc::new(Mutex::new(Vec::new()));
        let write_log = log.clone();
        let observe_log = log.clone();
        let observe = tokio::spawn(async move {
            let _turn = third.enter().await;
            observe_log.lock().unwrap().push("observe");
        });
        let write = tokio::spawn(async move {
            let _turn = second.enter().await;
            write_log.lock().unwrap().push("type");
        });
        let _independent =
            tokio::time::timeout(std::time::Duration::from_secs(1), independent.enter())
                .await
                .unwrap();
        assert!(log.lock().unwrap().is_empty());
        log.lock().unwrap().push("select");
        drop(first);
        write.await.unwrap();
        observe.await.unwrap();
        assert_eq!(*log.lock().unwrap(), ["select", "type", "observe"]);
    }

    #[tokio::test]
    async fn cancellation_releases_the_next_browser_call() {
        let mut order = BrowserBatchOrder::default();
        let first = order.reserve(true);
        let second = order.reserve(is_browser_tool_name("browser_type"));
        drop(first);
        let _turn = tokio::time::timeout(std::time::Duration::from_secs(1), second.enter())
            .await
            .unwrap();
    }
}
