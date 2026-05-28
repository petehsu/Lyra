use super::Agent;
use crate::logging;
use crate::message::{ContentBlock, Role};
use crate::protocol::ServerEvent;
use crate::session::StoredDisplayRole;
use anyhow::Result;
use jcode_agent_runtime::{
    InterruptSignal, SoftInterruptMessage, SoftInterruptQueue, SoftInterruptSource,
};
use std::sync::Arc;

fn soft_interrupt_session_display_role(source: SoftInterruptSource) -> Option<StoredDisplayRole> {
    match source {
        SoftInterruptSource::User => None,
        SoftInterruptSource::System => Some(StoredDisplayRole::System),
        SoftInterruptSource::BackgroundTask => Some(StoredDisplayRole::BackgroundTask),
    }
}

fn soft_interrupt_protocol_display_role(source: SoftInterruptSource) -> Option<String> {
    match source {
        SoftInterruptSource::User => None,
        SoftInterruptSource::System => Some("system".to_string()),
        SoftInterruptSource::BackgroundTask => Some("background_task".to_string()),
    }
}

#[derive(Debug, Clone)]
pub(super) struct InjectedSoftInterrupt {
    pub(super) content: String,
    pub(super) source: SoftInterruptSource,
}

pub(super) enum NoToolCallOutcome {
    Break,
    ContinueWithoutEvent,
    FallbackAssistant {
        text: String,
    },
    ContinueWithSoftInterrupt {
        injected: Vec<InjectedSoftInterrupt>,
        point: &'static str,
    },
}

pub(super) enum EmptyToolResultRecovery {
    NotNeeded,
    Continue,
    Fallback(String),
}

pub(super) enum PostToolInterruptOutcome {
    NoInterrupt,
    SoftInterrupt {
        injected: Vec<InjectedSoftInterrupt>,
        point: &'static str,
    },
}

impl Agent {
    pub fn restore_persisted_soft_interrupts(&self) -> usize {
        let restored = match crate::soft_interrupt_store::take(self.session_id()) {
            Ok(items) => items,
            Err(err) => {
                logging::warn(&format!(
                    "Failed to restore persisted soft interrupts for {}: {}",
                    self.session_id(),
                    err
                ));
                return 0;
            }
        };

        if restored.is_empty() {
            return 0;
        }

        let restored_count = restored.len();
        if let Ok(mut queue) = self.soft_interrupt_queue.lock() {
            queue.extend(restored);
        } else {
            logging::warn(&format!(
                "Failed to restore persisted soft interrupts for {} because queue lock was poisoned",
                self.session_id()
            ));
            return 0;
        }

        logging::info(&format!(
            "Restored {} persisted soft interrupt(s) for session {}",
            restored_count,
            self.session_id()
        ));
        restored_count
    }

    pub fn persist_soft_interrupt_snapshot(&self) {
        let pending = match self.soft_interrupt_queue.lock() {
            Ok(queue) => queue.clone(),
            Err(_) => {
                logging::warn(&format!(
                    "Failed to snapshot soft interrupts for {} because queue lock was poisoned",
                    self.session_id()
                ));
                return;
            }
        };

        if let Err(err) = crate::soft_interrupt_store::overwrite(self.session_id(), &pending) {
            logging::warn(&format!(
                "Failed to persist {} soft interrupt(s) for {}: {}",
                pending.len(),
                self.session_id(),
                err
            ));
        }
    }

    /// Add a swarm alert to be injected into the next turn
    pub fn push_alert(&mut self, alert: String) {
        self.pending_alerts.push(alert);
    }

    /// Take all pending alerts (clears the queue)
    pub fn take_alerts(&mut self) -> Vec<String> {
        std::mem::take(&mut self.pending_alerts)
    }

    /// Queue a soft interrupt message to be injected at the next safe point.
    /// This method can be called even while the agent is processing (uses separate lock).
    pub fn queue_soft_interrupt(&self, content: String, urgent: bool, source: SoftInterruptSource) {
        if let Ok(mut queue) = self.soft_interrupt_queue.lock() {
            queue.push(SoftInterruptMessage {
                content,
                urgent,
                source,
            });
        }
    }

    /// Get a handle to the soft interrupt queue.
    /// The server can use this to queue interrupts without holding the agent lock.
    pub fn soft_interrupt_queue(&self) -> SoftInterruptQueue {
        Arc::clone(&self.soft_interrupt_queue)
    }

    /// Get a handle to the background tool signal.
    /// The server can use this to signal "move tool to background" without holding the agent lock.
    pub fn background_tool_signal(&self) -> InterruptSignal {
        self.background_tool_signal.clone()
    }

    pub fn graceful_shutdown_signal(&self) -> InterruptSignal {
        self.graceful_shutdown.clone()
    }

    pub fn request_graceful_shutdown(&self) {
        self.graceful_shutdown.fire();
    }

    pub(super) fn is_graceful_shutdown(&self) -> bool {
        self.graceful_shutdown.is_set()
    }

    /// Check if there are pending soft interrupts
    pub fn has_soft_interrupts(&self) -> bool {
        self.soft_interrupt_queue
            .lock()
            .map(|q| !q.is_empty())
            .unwrap_or(false)
    }

    /// Check if there's an urgent soft interrupt that should skip remaining tools
    pub fn has_urgent_interrupt(&self) -> bool {
        self.soft_interrupt_queue
            .lock()
            .map(|q| q.iter().any(|m| m.urgent))
            .unwrap_or(false)
    }

    /// Get count of queued soft interrupts
    pub fn soft_interrupt_count(&self) -> usize {
        self.soft_interrupt_queue
            .lock()
            .map(|q| q.len())
            .unwrap_or(0)
    }

    /// Get count of pending alerts
    pub fn pending_alert_count(&self) -> usize {
        self.pending_alerts.len()
    }

    /// Get pending alerts (for debug visibility)
    pub fn pending_alerts_preview(&self) -> Vec<String> {
        self.pending_alerts
            .iter()
            .take(10)
            .map(|s| {
                if s.len() > 100 {
                    format!("{}...", crate::util::truncate_str(s, 100))
                } else {
                    s.clone()
                }
            })
            .collect()
    }

    /// Get comprehensive debug info about agent internal state
    pub fn debug_info(&self) -> serde_json::Value {
        serde_json::json!({
            "provider": self.provider.name(),
            "model": self.provider.model(),
            "provider_session_id": self.provider_session_id,
            "last_upstream_provider": self.last_upstream_provider,
            "last_connection_type": self.last_connection_type,
            "active_skill": self.active_skill,
            "allowed_tools": self.allowed_tools,
            "session": {
                "id": self.session.id,
                "is_canary": self.session.is_canary,
                "model": self.session.model,
                "working_dir": self.session.working_dir,
                "message_count": self.session.messages.len(),
            },
            "interrupts": {
                "soft_interrupt_count": self.soft_interrupt_count(),
                "has_urgent": self.has_urgent_interrupt(),
                "pending_alert_count": self.pending_alert_count(),
                "soft_interrupts": self.soft_interrupts_preview(),
                "pending_alerts": self.pending_alerts_preview(),
            },
            "cache_tracker": {
                "turn_count": self.cache_tracker.turn_count(),
                "had_violation": self.cache_tracker.had_violation(),
            },
            "features": {
                "memory_enabled": self.memory_enabled,
            },
            "token_usage": {
                "input": self.last_usage.input_tokens,
                "output": self.last_usage.output_tokens,
                "cache_read": self.last_usage.cache_read_input_tokens,
                "cache_write": self.last_usage.cache_creation_input_tokens,
            },
        })
    }

    pub fn debug_memory_profile(&self) -> serde_json::Value {
        let process = crate::process_memory::snapshot_with_source("agent:memory");
        let soft_interrupt_text_bytes: usize = self
            .soft_interrupt_queue
            .lock()
            .map(|queue| queue.iter().map(|msg| msg.content.len()).sum())
            .unwrap_or(0);
        let pending_alert_text_bytes: usize =
            self.pending_alerts.iter().map(|alert| alert.len()).sum();

        serde_json::json!({
            "process": process,
            "session": self.session.debug_memory_profile(),
            "interrupts": {
                "soft_interrupt_count": self.soft_interrupt_count(),
                "soft_interrupt_text_bytes": soft_interrupt_text_bytes,
                "pending_alert_count": self.pending_alert_count(),
                "pending_alert_text_bytes": pending_alert_text_bytes,
            },
            "agent": {
                "memory_enabled": self.memory_enabled,
                "allowed_tools_count": self.allowed_tools.as_ref().map(|tools| tools.len()),
                "tool_call_ids": self.tool_call_ids.len(),
                "tool_result_ids": self.tool_result_ids.len(),
                "last_usage": {
                    "input": self.last_usage.input_tokens,
                    "output": self.last_usage.output_tokens,
                    "cache_read": self.last_usage.cache_read_input_tokens,
                    "cache_write": self.last_usage.cache_creation_input_tokens,
                },
            }
        })
    }

    /// Get soft interrupt previews (for debug visibility)
    pub fn soft_interrupts_preview(&self) -> Vec<(String, bool)> {
        self.soft_interrupt_queue
            .lock()
            .map(|q| {
                q.iter()
                    .take(10)
                    .map(|m| {
                        let preview = if m.content.len() > 100 {
                            format!("{}...", crate::util::truncate_str(&m.content, 100))
                        } else {
                            m.content.clone()
                        };
                        (preview, m.urgent)
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Inject all pending soft interrupt messages into the conversation.
    /// Returns the combined message content and clears the queue.
    pub(super) fn inject_soft_interrupts(&mut self) -> Vec<InjectedSoftInterrupt> {
        let messages: Vec<SoftInterruptMessage> = {
            let mut queue = match self.soft_interrupt_queue.lock() {
                Ok(queue) => queue,
                Err(_) => return Vec::new(),
            };
            if queue.is_empty() {
                return Vec::new();
            }
            queue.drain(..).collect()
        };

        let mut injected = Vec::new();
        let mut current_source: Option<SoftInterruptSource> = None;
        let mut current_parts: Vec<String> = Vec::new();

        let flush_group = |agent: &mut Self,
                           injected: &mut Vec<InjectedSoftInterrupt>,
                           source: SoftInterruptSource,
                           parts: &mut Vec<String>| {
            if parts.is_empty() {
                return;
            }
            let content = parts.join("\n\n");
            parts.clear();
            agent.add_message_with_display_role(
                Role::User,
                vec![ContentBlock::Text {
                    text: content.clone(),
                    cache_control: None,
                }],
                soft_interrupt_session_display_role(source),
            );
            injected.push(InjectedSoftInterrupt { content, source });
        };

        for message in messages {
            match current_source {
                Some(source) if source != message.source => {
                    flush_group(self, &mut injected, source, &mut current_parts);
                    current_source = Some(message.source);
                }
                None => current_source = Some(message.source),
                _ => {}
            }
            current_parts.push(message.content);
        }

        if let Some(source) = current_source {
            flush_group(self, &mut injected, source, &mut current_parts);
        }

        self.persist_session_best_effort("soft interrupt injection");
        injected
    }

    pub(super) fn handle_streaming_no_tool_calls(
        &mut self,
        stop_reason: Option<&str>,
        incomplete_continuations: &mut u32,
        response_had_visible_text: bool,
        empty_tool_result_continuations: &mut u32,
    ) -> Result<NoToolCallOutcome> {
        if self.maybe_continue_incomplete_response(stop_reason, incomplete_continuations)? {
            return Ok(NoToolCallOutcome::ContinueWithoutEvent);
        }
        match self.recover_empty_tool_result_response(
            response_had_visible_text,
            empty_tool_result_continuations,
        )? {
            EmptyToolResultRecovery::NotNeeded => {}
            EmptyToolResultRecovery::Continue => {
                return Ok(NoToolCallOutcome::ContinueWithoutEvent);
            }
            EmptyToolResultRecovery::Fallback(text) => {
                return Ok(NoToolCallOutcome::FallbackAssistant { text });
            }
        }
        logging::info("Turn complete - no tool calls");
        let injected = self.inject_soft_interrupts();
        if !injected.is_empty() {
            return Ok(NoToolCallOutcome::ContinueWithSoftInterrupt {
                injected,
                point: "B",
            });
        }
        Ok(NoToolCallOutcome::Break)
    }

    pub(super) fn recover_empty_tool_result_response(
        &mut self,
        response_had_visible_text: bool,
        empty_tool_result_continuations: &mut u32,
    ) -> Result<EmptyToolResultRecovery> {
        if response_had_visible_text {
            *empty_tool_result_continuations = 0;
            return Ok(EmptyToolResultRecovery::NotNeeded);
        }

        if !self.last_message_has_tool_result() && *empty_tool_result_continuations == 0 {
            return Ok(EmptyToolResultRecovery::NotNeeded);
        }

        const MAX_EMPTY_TOOL_RESULT_CONTINUATIONS: u32 = 2;
        if *empty_tool_result_continuations >= MAX_EMPTY_TOOL_RESULT_CONTINUATIONS {
            logging::warn(
                "Model kept returning empty responses after tool results; ending with a fallback summary instead of surfacing a provider error",
            );
            let fallback = self.empty_tool_result_fallback_text();
            self.add_message(
                Role::Assistant,
                vec![ContentBlock::Text {
                    text: fallback.clone(),
                    cache_control: None,
                }],
            );
            self.push_embedding_snapshot_if_semantic(&fallback);
            self.session.save()?;
            *empty_tool_result_continuations = 0;
            return Ok(EmptyToolResultRecovery::Fallback(fallback));
        }

        *empty_tool_result_continuations += 1;
        logging::warn(&format!(
            "Model returned an empty response after tool results; retrying with a continuation reminder ({}/{})",
            *empty_tool_result_continuations, MAX_EMPTY_TOOL_RESULT_CONTINUATIONS
        ));
        if let Ok(store) = crate::memory::agent_runtime::AgentMemoryStore::new_default() {
            let _ = store.ensure_session_with_id(
                self.session_id(),
                crate::memory::agent_runtime::CreateSessionInput {
                    title: Some(self.session.display_title_or_name().to_string()),
                    working_dir: self.session.working_dir.clone(),
                    provider_key: self.session.provider_key.clone(),
                    model: self.session.model.clone(),
                },
            );
            let _ = store.append_event(
                self.session_id(),
                crate::memory::agent_runtime::NewSessionEvent::runtime_event(
                    "empty_tool_result_recovery",
                    None,
                    serde_json::json!({
                        "attempt": *empty_tool_result_continuations,
                        "maxAttempts": MAX_EMPTY_TOOL_RESULT_CONTINUATIONS
                    }),
                ),
            );
        }
        Ok(EmptyToolResultRecovery::Continue)
    }

    pub(super) fn last_message_has_tool_result(&self) -> bool {
        self.session.messages.last().is_some_and(|message| {
            message
                .content
                .iter()
                .any(|block| matches!(block, ContentBlock::ToolResult { .. }))
        })
    }

    pub(super) fn empty_tool_result_fallback_text(&self) -> String {
        let latest_tool_result = self.session.messages.iter().rev().find_map(|message| {
            let snippets = message
                .content
                .iter()
                .filter_map(|block| match block {
                    ContentBlock::ToolResult { content, .. } => {
                        let content = content.trim();
                        (!content.is_empty()).then(|| content.to_string())
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();

            (!snippets.is_empty()).then(|| snippets.join("\n\n"))
        });

        match latest_tool_result {
            Some(tool_result) => {
                let truncated = crate::util::truncate_str(&tool_result, 4000);
                let suffix = if truncated.len() < tool_result.len() {
                    "\n\n[Tool result truncated.]"
                } else {
                    ""
                };
                format!(
                    "I have the tool result, but the model did not produce a user-visible answer after retrying. Here is the latest available result so the turn does not end silently:\n\n{}{}",
                    truncated, suffix
                )
            }
            None => {
                "I received tool-result context, but the model did not produce a user-visible answer after retrying. I kept the turn state intact so you can continue from here.".to_string()
            }
        }
    }

    pub(super) fn take_post_tool_soft_interrupt(&mut self) -> PostToolInterruptOutcome {
        let injected = self.inject_soft_interrupts();
        if !injected.is_empty() {
            PostToolInterruptOutcome::SoftInterrupt {
                injected,
                point: "D",
            }
        } else {
            PostToolInterruptOutcome::NoInterrupt
        }
    }

    pub(super) fn build_soft_interrupt_events(
        injected: Vec<InjectedSoftInterrupt>,
        point: &'static str,
        tools_skipped: Option<usize>,
    ) -> Vec<ServerEvent> {
        injected
            .into_iter()
            .enumerate()
            .map(|(idx, interrupt)| ServerEvent::SoftInterruptInjected {
                content: interrupt.content,
                display_role: soft_interrupt_protocol_display_role(interrupt.source),
                point: point.to_string(),
                tools_skipped: if idx == 0 { tools_skipped } else { None },
            })
            .collect()
    }
}
