use thiserror::Error;

#[derive(Debug, Error)]
pub enum HardwareError {
    #[error("{code}: {message}")]
    Failure { code: &'static str, message: String },
}

impl HardwareError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self::Failure {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Failure { code, .. } => code,
        }
    }

    pub fn poisoned() -> Self {
        Self::new(
            "hardware_state_poisoned",
            "hardware runtime state is unavailable",
        )
    }

    pub fn not_found(kind: &'static str, id: String) -> Self {
        Self::new("hardware_not_found", format!("{kind} not found: {id}"))
    }
}
