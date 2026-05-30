#[derive(Clone, Debug, Default)]
pub struct ContextBuilder;

impl ContextBuilder {
    pub const NAME: &'static str = "context_builder";

    pub fn build_prompt_context(
        &self,
        messages: Vec<lyra_agent_api::AgentMessage>,
        memory: Option<lyra_agent_api::AgentMemoryProjection>,
    ) -> serde_json::Value {
        serde_json::json!({
            "messages": messages,
            "memory": memory,
        })
    }
}
