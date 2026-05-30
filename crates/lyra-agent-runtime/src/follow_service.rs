#[derive(Clone, Debug, Default)]
pub struct FollowService;

impl FollowService {
    pub const NAME: &'static str = "follow_service";

    pub fn state(
        &self,
        running: bool,
        activity: Option<String>,
    ) -> lyra_agent_api::AgentFollowState {
        lyra_agent_api::AgentFollowState { running, activity }
    }
}
