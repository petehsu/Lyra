use napi::{Error, Result, Status};

pub fn invalid_arg(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

pub fn failure(message: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, message.into())
}

pub fn core_error(error: lyra_files_core::FilesCoreError) -> Error {
    match error {
        lyra_files_core::FilesCoreError::InvalidArgument(message) => invalid_arg(message),
        other => failure(other.to_string()),
    }
}

pub fn io_error(message: impl Into<String>, error: std::io::Error) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("{}: {}", message.into(), error),
    )
}

pub type NapiResult<T> = Result<T>;
