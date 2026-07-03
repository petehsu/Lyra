use std::sync::{LockResult, Mutex as StdMutex, MutexGuard, TryLockError, TryLockResult};

#[derive(Debug)]
pub(crate) struct RecoveringMutex<T>(StdMutex<T>);

impl<T> RecoveringMutex<T> {
    pub(crate) const fn new(value: T) -> Self {
        Self(StdMutex::new(value))
    }

    pub(crate) fn lock(&self) -> LockResult<MutexGuard<'_, T>> {
        Ok(match self.0.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        })
    }

    pub(crate) fn try_lock(&self) -> TryLockResult<MutexGuard<'_, T>> {
        match self.0.try_lock() {
            Ok(guard) => Ok(guard),
            Err(TryLockError::Poisoned(poisoned)) => Ok(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => Err(TryLockError::WouldBlock),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovers_guard_after_panic_poisoning() {
        let mutex = RecoveringMutex::new(1usize);
        let _ = std::panic::catch_unwind(|| {
            let mut guard = mutex.lock().expect("initial lock");
            *guard = 2;
            panic!("poison mutex");
        });

        assert_eq!(*mutex.lock().expect("recovered lock"), 2);
        assert_eq!(*mutex.try_lock().expect("recovered try_lock"), 2);
    }
}
