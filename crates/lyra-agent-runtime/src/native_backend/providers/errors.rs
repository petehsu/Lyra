use crate::AgentRuntimeError;

pub(crate) fn unknown_route_error(route_id: &str) -> AgentRuntimeError {
    AgentRuntimeError::Core(format!("unknown provider route `{route_id}`"))
}
