use clap::{Parser, Subcommand};
use lyra_agent_runtime::{AgentRuntimeServices, LyraAgentBackend};
use serde_json::json;
use std::sync::Arc;

#[derive(Debug, Parser)]
#[command(name = "lyra")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Agent {
        #[command(subcommand)]
        command: AgentCommand,
    },
}

#[derive(Debug, Subcommand)]
enum AgentCommand {
    Run {
        prompt: String,
        #[arg(long)]
        session_id: Option<String>,
    },
    Chat,
    Sessions {
        #[command(subcommand)]
        command: SessionCommand,
    },
    Memory {
        #[command(subcommand)]
        command: MemoryCommand,
    },
    Provider {
        #[command(subcommand)]
        command: ProviderCommand,
    },
    Events,
    Tools {
        #[command(subcommand)]
        command: ToolsCommand,
    },
    Software {
        #[command(subcommand)]
        command: SoftwareCommand,
    },
}

#[derive(Debug, Subcommand)]
enum SessionCommand {
    List,
    Read { id: String },
}

#[derive(Debug, Subcommand)]
enum MemoryCommand {
    Search { query: String },
}

#[derive(Debug, Subcommand)]
enum ProviderCommand {
    List,
}

#[derive(Debug, Subcommand)]
enum ToolsCommand {
    List,
}

#[derive(Debug, Subcommand)]
enum SoftwareCommand {
    List,
}

fn main() {
    let cli = Cli::parse();
    let services = AgentRuntimeServices::with_backend(Arc::new(LyraAgentBackend));
    services.attach_core_event_bus();
    let output = match cli.command {
        Command::Agent { command } => handle_agent(command, &services),
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&output).expect("serialize CLI output")
    );
}

fn handle_agent(command: AgentCommand, services: &AgentRuntimeServices) -> serde_json::Value {
    match match command {
        AgentCommand::Run { prompt, session_id } => {
            run_prompt_with_events(prompt, session_id, services)
        }
        AgentCommand::Chat => Ok(json!({
            "status": "ready",
            "mode": "chat",
            "runtimeServices": services.service_names(),
        })),
        AgentCommand::Sessions { command } => match command {
            SessionCommand::List => services.session.list(None),
            SessionCommand::Read { id } => services.session.read(Some(id)),
        },
        AgentCommand::Memory { command } => match command {
            MemoryCommand::Search { query } => services.memory.search_shared(query),
        },
        AgentCommand::Provider { command } => match command {
            ProviderCommand::List => services.provider.provider_profiles(),
        },
        AgentCommand::Events => Ok(json!({
            "events": services.event_bus.replay(),
        })),
        AgentCommand::Tools { command } => match command {
            ToolsCommand::List => Ok(services.tool_activity.built_in_capabilities()),
        },
        AgentCommand::Software { command } => match command {
            SoftwareCommand::List => services.software.list_capabilities(),
        },
    } {
        Ok(value) => value,
        Err(error) => json!({
            "ok": false,
            "error": {
                "message": error.to_string(),
            },
        }),
    }
}

fn run_prompt_with_events(
    prompt: String,
    session_id: Option<String>,
    services: &AgentRuntimeServices,
) -> lyra_agent_runtime::AgentRuntimeResult<serde_json::Value> {
    let mut value = services.turn_runner.run_prompt(prompt, session_id)?;
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "runtimeEvents".to_string(),
            serde_json::Value::Array(services.event_bus.drain()),
        );
    }
    Ok(value)
}
