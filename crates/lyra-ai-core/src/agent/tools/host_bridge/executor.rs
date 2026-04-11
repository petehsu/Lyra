use std::sync::Arc;

use serde_json::Value;

use super::types::{HostToolCallContext, HostToolDescriptor};
use crate::agent::tools::{AgentToolError, ExternalToolExecutionContext, ExternalToolExecutor};

pub type HostToolInvoker = Arc<
    dyn Fn(&HostToolDescriptor, &Value, &HostToolCallContext) -> Result<Value, AgentToolError>
        + Send
        + Sync,
>;

pub fn build_host_tool_executor(
    descriptor: HostToolDescriptor,
    invoker: HostToolInvoker,
) -> ExternalToolExecutor {
    Arc::new(
        move |input: &Value, context: &ExternalToolExecutionContext| {
            invoker(&descriptor, input, &HostToolCallContext::from(context))
        },
    )
}
