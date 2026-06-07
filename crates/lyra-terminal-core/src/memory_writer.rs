//! Background memory-persistence worker for terminal sessions.
//!
//! `SessionRuntime` owns an optional `TerminalMemoryWriter` whose channel feeds
//! a dedicated thread (`run_terminal_memory_writer`) that durably records shell
//! events, output, resizes and lifecycle transitions via the `memory` module.
//! Extracted from `lib.rs` as a self-contained unit (only depends on `memory`).

use std::sync::mpsc;
use std::thread;

use serde_json::Value;

use crate::memory;
use crate::shell_integration;
use crate::MEMORY_WORKER_OUTPUT_BATCH_BYTES;
use crate::emit_command_completion;

#[derive(Clone)]
pub(crate) struct TerminalMemoryWriter {
    sender: mpsc::Sender<TerminalMemoryTask>,
}

pub(crate) enum TerminalMemoryTask {
    ShellEvent(shell_integration::ShellIntegrationEvent),
    Output(Vec<u8>),
    ScreenDiff(Value),
    Write(memory::WriteInput),
    Resize(memory::ResizeInput),
    Close(memory::CloseInput),
    ProcessSignal(memory::ProcessSignalInput),
    Exit(i32),
    Error(String),
}

impl TerminalMemoryWriter {
    pub(crate) fn new(storage_root: String, session_id: String, source: String, mode: String) -> Self {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            run_terminal_memory_writer(storage_root, session_id, source, mode, receiver);
        });
        Self { sender }
    }

    pub(crate) fn enqueue(&self, task: TerminalMemoryTask) {
        let _ = self.sender.send(task);
    }
}

fn run_terminal_memory_writer(
    storage_root: String,
    session_id: String,
    source: String,
    mode: String,
    receiver: mpsc::Receiver<TerminalMemoryTask>,
) {
    let context = memory::MemoryContext {
        storage_root,
        session_id: session_id.clone(),
    };
    let mut pending: Option<TerminalMemoryTask> = None;
    loop {
        let task = match pending.take() {
            Some(task) => task,
            None => match receiver.recv() {
                Ok(task) => task,
                Err(_) => break,
            },
        };
        match task {
            TerminalMemoryTask::ShellEvent(event) => {
                if let Ok(Some(completion)) =
                    memory::record_shell_integration_event(&context, &event)
                {
                    emit_command_completion(&session_id, &source, &mode, completion);
                }
            }
            TerminalMemoryTask::Output(mut bytes) => {
                let mut disconnected = false;
                while bytes.len() < MEMORY_WORKER_OUTPUT_BATCH_BYTES {
                    match receiver.try_recv() {
                        Ok(TerminalMemoryTask::Output(next)) => {
                            bytes.extend_from_slice(&next);
                        }
                        Ok(other) => {
                            pending = Some(other);
                            break;
                        }
                        Err(mpsc::TryRecvError::Empty) => break,
                        Err(mpsc::TryRecvError::Disconnected) => {
                            disconnected = true;
                            break;
                        }
                    }
                }
                let _ = memory::record_output(&context, &bytes);
                if disconnected {
                    break;
                }
            }
            TerminalMemoryTask::ScreenDiff(payload) => {
                let _ = memory::record_screen_diff(&context, payload);
            }
            TerminalMemoryTask::Write(input) => {
                let _ = memory::record_write(input);
            }
            TerminalMemoryTask::Resize(input) => {
                let _ = memory::record_resize(input);
            }
            TerminalMemoryTask::Close(input) => {
                let _ = memory::record_close(input);
            }
            TerminalMemoryTask::ProcessSignal(input) => {
                let _ = memory::record_process_signal_sent(input);
            }
            TerminalMemoryTask::Exit(exit_code) => {
                if let Ok(Some(completion)) = memory::record_exit(&context, exit_code) {
                    emit_command_completion(&session_id, &source, &mode, completion);
                }
            }
            TerminalMemoryTask::Error(error) => {
                let _ = memory::record_error(&context, &error);
            }
        }
    }
}
