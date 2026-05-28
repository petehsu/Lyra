use super::{
    SessionAgents, SessionInterruptQueues, SwarmMember, fanout_session_event,
    queue_soft_interrupt_for_session, session_event_fanout_sender,
};
use crate::message::{
    ContentBlock, Role, format_background_task_notification_markdown,
    format_background_task_progress_markdown,
};
use crate::protocol::{NotificationType, ServerEvent};
use crate::session::{Session, StoredMessage};
use chrono::{DateTime, Utc};
use jcode_agent_runtime::SoftInterruptSource;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

fn is_real_user_request(message: &StoredMessage) -> bool {
    if message.role != Role::User || message.display_role.is_some() {
        return false;
    }

    let mut saw_text = false;
    for block in &message.content {
        match block {
            ContentBlock::Text { text, .. } => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    saw_text = true;
                }
            }
            ContentBlock::Image { .. } => {}
            _ => return false,
        }
    }

    saw_text
}

fn has_real_user_request_after(messages: &[StoredMessage], started_at: DateTime<Utc>) -> bool {
    messages.iter().any(|message| {
        is_real_user_request(message)
            && message
                .timestamp
                .map(|timestamp| timestamp > started_at)
                .unwrap_or(false)
    })
}

fn parse_started_at(started_at: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(started_at)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

async fn background_wake_would_resume_suspended_work(
    task: &crate::bus::BackgroundTaskCompleted,
    sessions: &SessionAgents,
) -> bool {
    let Some(status) = crate::background::global().status(&task.task_id).await else {
        return false;
    };
    let Some(started_at) = parse_started_at(&status.started_at) else {
        return false;
    };

    let agent = {
        let guard = sessions.read().await;
        guard.get(&task.session_id).cloned()
    };

    if let Some(agent) = agent
        && let Ok(agent_guard) = agent.try_lock()
    {
        return has_real_user_request_after(agent_guard.messages(), started_at);
    }

    Session::load(&task.session_id)
        .map(|session| has_real_user_request_after(&session.messages, started_at))
        .unwrap_or(false)
}

async fn run_background_task_message_in_live_session_if_idle(
    session_id: &str,
    message: &str,
    sessions: &SessionAgents,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
) -> bool {
    let agent = {
        let guard = sessions.read().await;
        guard.get(session_id).cloned()
    };
    let Some(agent) = agent else {
        return false;
    };

    let has_live_attachments = {
        let members = swarm_members.read().await;
        members
            .get(session_id)
            .map(|member| !member.event_txs.is_empty() || !member.event_tx.is_closed())
            .unwrap_or(false)
    };
    if !has_live_attachments {
        return false;
    }

    let is_idle = match agent.try_lock() {
        Ok(guard) => {
            drop(guard);
            true
        }
        Err(_) => false,
    };

    if !is_idle {
        return false;
    }

    let session_id = session_id.to_string();
    let message = message.to_string();
    let event_tx = session_event_fanout_sender(session_id.clone(), Arc::clone(swarm_members));
    tokio::spawn(async move {
        if let Err(err) = super::client_lifecycle::process_message_streaming_mpsc(
            agent,
            &message,
            vec![],
            Some(
                "A background task for this session just finished. Treat it as context for the current task. Do not resume older suspended work unless the latest real user message explicitly asks for it."
                    .to_string(),
            ),
            event_tx,
        )
        .await
        {
            crate::logging::error(&format!(
                "Failed to run background task completion immediately for live session {}: {}",
                session_id, err
            ));
        }
    });

    true
}

pub(super) async fn dispatch_background_task_completion(
    task: &crate::bus::BackgroundTaskCompleted,
    sessions: &SessionAgents,
    soft_interrupt_queues: &SessionInterruptQueues,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
) {
    let notification = format_background_task_notification_markdown(task);

    if task.notify
        && fanout_session_event(
            swarm_members,
            &task.session_id,
            ServerEvent::Notification {
                from_session: "background_task".to_string(),
                from_name: Some("background task".to_string()),
                notification_type: NotificationType::Message {
                    scope: Some("background_task".to_string()),
                    channel: None,
                },
                message: notification.clone(),
            },
        )
        .await
            == 0
    {
        crate::logging::warn(&format!(
            "Failed to notify attached clients for background task completion on session {}",
            task.session_id
        ));
    }

    if task.wake && background_wake_would_resume_suspended_work(task, sessions).await {
        crate::logging::info(&format!(
            "Suppressed background task wake for {} in session {} because a newer user request exists",
            task.task_id, task.session_id
        ));
        return;
    }

    if task.wake
        && !run_background_task_message_in_live_session_if_idle(
            &task.session_id,
            &notification,
            sessions,
            swarm_members,
        )
        .await
        && !queue_soft_interrupt_for_session(
            &task.session_id,
            notification.clone(),
            false,
            SoftInterruptSource::BackgroundTask,
            soft_interrupt_queues,
            sessions,
        )
        .await
    {
        crate::logging::warn(&format!(
            "Failed to deliver background task completion to session {}",
            task.session_id
        ));
    }
}

pub(super) async fn dispatch_background_task_progress(
    task: &crate::bus::BackgroundTaskProgressEvent,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
) {
    let notification = format_background_task_progress_markdown(task);
    if fanout_session_event(
        swarm_members,
        &task.session_id,
        ServerEvent::Notification {
            from_session: "background_task".to_string(),
            from_name: Some("background task".to_string()),
            notification_type: NotificationType::Message {
                scope: Some("background_task".to_string()),
                channel: None,
            },
            message: notification,
        },
    )
    .await
        == 0
    {
        crate::logging::warn(&format!(
            "Failed to notify attached clients for background task progress on session {}",
            task.session_id
        ));
    }
}

pub(super) async fn dispatch_ui_activity(
    activity: &crate::bus::UiActivity,
    swarm_members: &Arc<RwLock<HashMap<String, SwarmMember>>>,
) {
    let Some(session_id) = activity.session_id.as_deref() else {
        return;
    };

    if fanout_session_event(
        swarm_members,
        session_id,
        ServerEvent::Notification {
            from_session: "jcode".to_string(),
            from_name: Some("Jcode".to_string()),
            notification_type: NotificationType::Message {
                scope: Some(activity.kind.scope().to_string()),
                channel: None,
            },
            message: activity.message.clone(),
        },
    )
    .await
        == 0
    {
        crate::logging::warn(&format!(
            "Failed to notify attached clients for UI activity on session {}",
            session_id
        ));
    }
}
