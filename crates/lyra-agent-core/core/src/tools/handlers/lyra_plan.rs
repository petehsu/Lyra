use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;
use lyra_protocol::config_types::ModeKind;
use lyra_protocol::items::PlanItem;
use lyra_protocol::items::TurnItem;
use lyra_protocol::plan_tool::LyraPlanAction;
use lyra_protocol::plan_tool::LyraPlanArgs;
use lyra_protocol::plan_tool::PlanArtifact;
use lyra_protocol::plan_tool::PlanArtifactBlock;
use lyra_protocol::plan_tool::PlanArtifactStatus;
use lyra_protocol::protocol::SessionSource;
use lyra_protocol::request_user_input::RequestUserInputArgs;
use lyra_tools::LYRA_PLAN_TOOL_NAME;
use lyra_tools::normalize_request_user_input_args;
use std::collections::HashSet;

pub struct LyraPlanHandler;

impl ToolHandler for LyraPlanHandler {
    type Output = FunctionToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError> {
        let ToolInvocation {
            session,
            turn,
            call_id,
            tool_name,
            payload,
            ..
        } = invocation;

        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(format!(
                    "{LYRA_PLAN_TOOL_NAME} handler received unsupported payload"
                )));
            }
        };

        if turn.collaboration_mode.mode != ModeKind::Plan {
            return Err(FunctionCallError::RespondToModel(
                "plan tools can only be used in Plan Mode".to_string(),
            ));
        }

        if tool_name.name.as_str() != LYRA_PLAN_TOOL_NAME {
            return Err(FunctionCallError::Fatal(format!(
                "unexpected plan tool handler dispatch for {}",
                tool_name.display()
            )));
        }

        handle_lyra_plan(session, turn, call_id, arguments).await
    }
}

async fn handle_lyra_plan(
    session: std::sync::Arc<crate::session::session::Session>,
    turn: std::sync::Arc<crate::session::turn_context::TurnContext>,
    call_id: String,
    arguments: String,
) -> Result<FunctionToolOutput, FunctionCallError> {
    let args: LyraPlanArgs = parse_arguments(&arguments)?;
    match args.action {
        LyraPlanAction::Draft => {
            let artifact = normalize_plan_artifact(args.plan, PlanArtifactStatus::Draft, "draft")?;
            emit_plan_artifact(session, turn, artifact, LYRA_PLAN_TOOL_NAME).await?;
            Ok(FunctionToolOutput::from_text(
                "Plan draft recorded. Continue planning, ask structured questions if needed, or propose the final plan with lyra_plan action=\"propose\".".to_string(),
                Some(true),
            ))
        }
        LyraPlanAction::Propose => {
            let artifact =
                normalize_plan_artifact(args.plan, PlanArtifactStatus::Proposed, "propose")?;
            emit_plan_artifact(session, turn, artifact, LYRA_PLAN_TOOL_NAME).await?;
            Ok(FunctionToolOutput::from_text(
                "Plan proposal submitted to the host UI for user approval.".to_string(),
                Some(true),
            ))
        }
        LyraPlanAction::Ask => {
            if matches!(turn.session_source, SessionSource::SubAgent(_)) {
                return Err(FunctionCallError::RespondToModel(
                    "lyra_plan action=\"ask\" can only be used by the root thread".to_string(),
                ));
            }
            let questions = args.questions.unwrap_or_default();
            if questions.is_empty() {
                return Err(FunctionCallError::RespondToModel(
                    "lyra_plan action=\"ask\" requires one to three questions".to_string(),
                ));
            }
            let request = normalize_request_user_input_args(RequestUserInputArgs { questions })
                .map_err(FunctionCallError::RespondToModel)?;
            let response = session
                .request_user_input(turn.as_ref(), call_id, request)
                .await
                .ok_or_else(|| {
                    FunctionCallError::RespondToModel(
                        "lyra_plan action=\"ask\" was cancelled before receiving a response"
                            .to_string(),
                    )
                })?;
            let content = serde_json::to_string(&response).map_err(|err| {
                FunctionCallError::Fatal(format!(
                    "failed to serialize lyra_plan ask response: {err}"
                ))
            })?;
            Ok(FunctionToolOutput::from_text(content, Some(true)))
        }
    }
}

fn normalize_plan_artifact(
    plan: Option<PlanArtifact>,
    status: PlanArtifactStatus,
    action: &str,
) -> Result<PlanArtifact, FunctionCallError> {
    let mut artifact = plan.ok_or_else(|| {
        FunctionCallError::RespondToModel(format!(
            "lyra_plan action=\"{action}\" requires a structured plan object"
        ))
    })?;
    artifact.status = status;
    trim_plan_artifact(&mut artifact);
    validate_plan_artifact(&artifact, action)?;
    Ok(artifact)
}

fn trim_plan_artifact(artifact: &mut PlanArtifact) {
    artifact.plan_id = artifact.plan_id.trim().to_string();
    artifact.title = artifact.title.trim().to_string();
    artifact.summary = artifact.summary.trim().to_string();
    artifact.objective = artifact.objective.trim().to_string();
    for block in artifact
        .assumptions
        .iter_mut()
        .chain(artifact.steps.iter_mut())
        .chain(artifact.interfaces.iter_mut())
        .chain(artifact.risks.iter_mut())
        .chain(artifact.tests.iter_mut())
        .chain(artifact.acceptance_criteria.iter_mut())
    {
        trim_plan_block(block);
    }
}

fn trim_plan_block(block: &mut PlanArtifactBlock) {
    block.id = block.id.trim().to_string();
    block.kind = block.kind.trim().to_string();
    block.title = block.title.trim().to_string();
    block.body = block.body.trim().to_string();
}

fn validate_plan_artifact(artifact: &PlanArtifact, action: &str) -> Result<(), FunctionCallError> {
    for (field, value) in [
        ("planId", artifact.plan_id.as_str()),
        ("title", artifact.title.as_str()),
        ("summary", artifact.summary.as_str()),
        ("objective", artifact.objective.as_str()),
    ] {
        if value.is_empty() {
            return Err(FunctionCallError::RespondToModel(format!(
                "lyra_plan action=\"{action}\" requires plan.{field} to be non-empty"
            )));
        }
    }

    let mut block_ids = HashSet::new();
    let mut block_count = 0usize;
    for (section, block) in plan_blocks(artifact) {
        block_count = block_count.saturating_add(1);
        for (field, value) in [
            ("id", block.id.as_str()),
            ("kind", block.kind.as_str()),
            ("title", block.title.as_str()),
            ("body", block.body.as_str()),
        ] {
            if value.is_empty() {
                return Err(FunctionCallError::RespondToModel(format!(
                    "lyra_plan action=\"{action}\" requires every {section} block to have non-empty {field}"
                )));
            }
        }
        if !block_ids.insert(block.id.as_str()) {
            return Err(FunctionCallError::RespondToModel(format!(
                "lyra_plan action=\"{action}\" requires unique block ids; duplicate id {:?}",
                block.id
            )));
        }
    }

    if block_count == 0 {
        return Err(FunctionCallError::RespondToModel(format!(
            "lyra_plan action=\"{action}\" requires at least one annotatable plan block"
        )));
    }

    Ok(())
}

fn plan_blocks<'a>(
    artifact: &'a PlanArtifact,
) -> impl Iterator<Item = (&'static str, &'a PlanArtifactBlock)> + 'a {
    artifact
        .assumptions
        .iter()
        .map(|block| ("assumptions", block))
        .chain(artifact.steps.iter().map(|block| ("steps", block)))
        .chain(
            artifact
                .interfaces
                .iter()
                .map(|block| ("interfaces", block)),
        )
        .chain(artifact.risks.iter().map(|block| ("risks", block)))
        .chain(artifact.tests.iter().map(|block| ("tests", block)))
        .chain(
            artifact
                .acceptance_criteria
                .iter()
                .map(|block| ("acceptanceCriteria", block)),
        )
}

async fn emit_plan_artifact(
    session: std::sync::Arc<crate::session::session::Session>,
    turn: std::sync::Arc<crate::session::turn_context::TurnContext>,
    artifact: PlanArtifact,
    tool_name: &str,
) -> Result<(), FunctionCallError> {
    let item = TurnItem::Plan(PlanItem {
        id: format!("{}-{tool_name}-{}", turn.sub_id, artifact.plan_id),
        artifact,
    });
    session.emit_turn_item_started(turn.as_ref(), &item).await;
    session.emit_turn_item_completed(turn.as_ref(), item).await;
    Ok(())
}
