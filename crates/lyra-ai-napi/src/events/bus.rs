use std::sync::Mutex;

#[cfg(not(test))]
use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi::{JsFunction, Result};
use once_cell::sync::Lazy;

#[cfg(not(test))]
use crate::error::to_json;
use crate::events::types::AiRuntimeEvent;

#[cfg(not(test))]
type EventCallback = ThreadsafeFunction<String, ErrorStrategy::CalleeHandled>;
#[cfg(not(test))]
static EVENT_CALLBACK: Lazy<Mutex<Option<EventCallback>>> = Lazy::new(|| Mutex::new(None));
#[cfg(test)]
static EVENT_CALLBACK: Lazy<Mutex<Option<()>>> = Lazy::new(|| Mutex::new(None));

pub fn register_callback(callback: JsFunction) -> Result<()> {
    #[cfg(test)]
    {
        let _ = callback;
        if let Ok(mut guard) = EVENT_CALLBACK.lock() {
            *guard = Some(());
        }
        Ok(())
    }

    #[cfg(not(test))]
    {
        let threadsafe = callback.create_threadsafe_function(
            0,
            |ctx: ThreadSafeCallContext<String>| -> Result<Vec<napi::JsUnknown>> {
                Ok(vec![ctx
                    .env
                    .create_string_from_std(ctx.value)?
                    .into_unknown()])
            },
        )?;

        if let Ok(mut guard) = EVENT_CALLBACK.lock() {
            *guard = Some(threadsafe);
        }
        Ok(())
    }
}

#[cfg(not(test))]
pub fn publish_session_updated(event: &AiRuntimeEvent) {
    let Ok(payload) = to_json(event) else {
        return;
    };

    if let Ok(guard) = EVENT_CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            let _ = callback.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }
}

#[cfg(test)]
pub fn publish_session_updated(_event: &AiRuntimeEvent) {}
