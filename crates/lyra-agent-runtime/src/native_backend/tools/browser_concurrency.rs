use std::sync::atomic::{AtomicUsize, Ordering};

const MAX_BROWSER_HOST_CALLS: usize = 2;

static BROWSER_HOST_INFLIGHT: AtomicUsize = AtomicUsize::new(0);

pub(crate) struct BrowserConcurrencyGuard {
    active: bool,
}

impl BrowserConcurrencyGuard {
    pub(crate) fn try_acquire() -> Result<Self, String> {
        loop {
            let current = BROWSER_HOST_INFLIGHT.load(Ordering::Acquire);
            if current >= MAX_BROWSER_HOST_CALLS {
                return Err(format!(
                    "browser host concurrency limit reached ({MAX_BROWSER_HOST_CALLS} in flight); retry after an in-progress browser tool finishes"
                ));
            }
            if BROWSER_HOST_INFLIGHT
                .compare_exchange_weak(current, current + 1, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                return Ok(Self { active: true });
            }
        }
    }
}

impl Drop for BrowserConcurrencyGuard {
    fn drop(&mut self) {
        if self.active {
            BROWSER_HOST_INFLIGHT.fetch_sub(1, Ordering::AcqRel);
            self.active = false;
        }
    }
}
