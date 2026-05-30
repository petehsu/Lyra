#[derive(Clone, Debug, Default)]
pub struct TodoService;

impl TodoService {
    pub const NAME: &'static str = "todo_service";

    pub fn project(
        &self,
        todos: Vec<lyra_agent_api::ActiveTodo>,
    ) -> Vec<lyra_agent_api::ActiveTodo> {
        todos
    }
}
