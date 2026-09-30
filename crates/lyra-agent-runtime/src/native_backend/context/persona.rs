//! Optional identity inference must never run subprocesses on the send path.
use crate::persona::ComputedPersona;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Default)]
struct CachedPersona {
    allowed: bool,
    generation: u64,
    running: bool,
    value: Option<(Instant, ComputedPersona)>,
}

impl CachedPersona {
    fn update(&mut self, allowed: bool) -> (Option<ComputedPersona>, Option<u64>) {
        if self.allowed != allowed {
            self.allowed = allowed;
            self.generation = self.generation.wrapping_add(1);
            self.value = None;
        }
        if !allowed {
            return (None, None);
        }
        let stale = self
            .value
            .as_ref()
            .is_none_or(|(at, _)| at.elapsed() >= Duration::from_secs(300));
        let refresh = (stale && !self.running).then_some(self.generation);
        if refresh.is_some() {
            self.running = true;
        }
        (self.value.as_ref().map(|(_, value)| value.clone()), refresh)
    }

    fn finish(&mut self, generation: u64, value: ComputedPersona) {
        self.running = false;
        if self.allowed && self.generation == generation {
            self.value = Some((Instant::now(), value));
        }
    }
}

pub(crate) fn computed_persona_for_turn(allowed: bool) -> Option<ComputedPersona> {
    static CACHE: OnceLock<Arc<Mutex<CachedPersona>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let (value, refresh) = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .update(allowed);
    if let Some(generation) = refresh {
        let cache = cache.clone();
        std::thread::spawn(move || {
            let signals = crate::persona::collect_local_signals(Default::default());
            let persona = crate::persona::compute_persona(&signals);
            cache
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .finish(generation, persona);
        });
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn consent_revocation_discards_inflight_results_and_refresh_is_coalesced() {
        let mut cache = CachedPersona::default();
        assert!(cache.update(false).1.is_none());
        let generation = cache.update(true).1.unwrap();
        assert!(cache.update(true).1.is_none());
        assert!(cache.update(false).0.is_none());
        cache.update(true);
        cache.finish(generation, ComputedPersona::fallback_lyra());
        assert!(cache.value.is_none());
        let generation = cache.update(true).1.unwrap();
        cache.finish(generation, ComputedPersona::fallback_lyra());
        assert!(cache.update(true).0.is_some());
        assert!(cache.update(true).1.is_none());
        assert!(cache.update(false).0.is_none());
    }
}
