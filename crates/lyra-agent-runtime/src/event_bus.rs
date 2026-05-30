use std::sync::{
    Arc, Mutex,
    mpsc::{self, Receiver, Sender},
};

use serde_json::Value;

use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct RuntimeEventBus {
    events: Arc<Mutex<Vec<Value>>>,
    subscribers: Arc<Mutex<Vec<Sender<Value>>>>,
    backend: BackendHandle,
}

impl Default for RuntimeEventBus {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl RuntimeEventBus {
    pub const NAME: &'static str = "event_bus";

    pub fn new(backend: BackendHandle) -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
            subscribers: Arc::new(Mutex::new(Vec::new())),
            backend,
        }
    }

    pub fn attach_runtime_events(&self) {
        let bus = self.clone();
        self.backend.register_event_callback(Arc::new(move |event| {
            bus.publish_raw(&event);
        }));
    }

    pub fn attach_core_events(&self) {
        self.attach_runtime_events();
    }

    pub fn publish_raw(&self, event: &str) {
        let value = serde_json::from_str(event)
            .unwrap_or_else(|_| serde_json::json!({ "kind": "unparsed", "raw": event }));
        self.publish(value);
    }

    pub fn publish(&self, event: Value) {
        if let Ok(mut events) = self.events.lock() {
            events.push(event.clone());
        }
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.retain(|subscriber| subscriber.send(event.clone()).is_ok());
        }
    }

    pub fn drain(&self) -> Vec<Value> {
        self.events
            .lock()
            .map(|mut events| events.drain(..).collect())
            .unwrap_or_default()
    }

    pub fn replay(&self) -> Vec<Value> {
        self.events
            .lock()
            .map(|events| events.clone())
            .unwrap_or_default()
    }

    pub fn subscribe(&self) -> Receiver<Value> {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.push(tx);
        }
        rx
    }
}
