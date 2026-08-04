use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::{self, JoinHandle};

use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder};
use wasmtime_wasi::p2::add_to_linker_sync;
use wasmtime_wasi::p2::bindings::sync::Command;
use wasmtime_wasi::{DirPerms, FilePerms, WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

use crate::limits::WasiExecutionLimits;
use crate::policy::{DirectoryAccess, ResolvedWasiPolicy, WasiComponentPolicy};
use crate::{HostError, Result};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WasiRunOutcome {
    Success,
    GuestFailure,
}

#[derive(Clone, Debug)]
pub struct WasiComponentHost {
    limits: WasiExecutionLimits,
}

impl WasiComponentHost {
    pub fn new(limits: WasiExecutionLimits) -> Result<Self> {
        limits.validate()?;
        Ok(Self { limits })
    }

    pub fn limits(&self) -> &WasiExecutionLimits {
        &self.limits
    }

    /// Executes only WebAssembly Component Model bytes implementing
    /// `wasi:cli/command`. This API deliberately has no native executable path.
    pub fn run_component(
        &self,
        component_bytes: &[u8],
        policy: &WasiComponentPolicy,
    ) -> Result<WasiRunOutcome> {
        if component_bytes.len() > self.limits.max_component_bytes {
            return Err(HostError::ComponentTooLarge {
                actual: component_bytes.len(),
                maximum: self.limits.max_component_bytes,
            });
        }

        let resolved_policy = policy.prepare()?;
        let engine = build_engine()?;
        let component = Component::new(&engine, component_bytes).map_err(HostError::Component)?;
        let mut linker = Linker::new(&engine);
        add_to_linker_sync(&mut linker).map_err(HostError::Runtime)?;
        let mut store = build_store(&engine, &self.limits, &resolved_policy)?;
        let timer = ExecutionTimer::arm(engine, self.limits.timeout)?;

        let result = (|| {
            let command = Command::instantiate(&mut store, &component, &linker)
                .map_err(HostError::Runtime)?;
            let outcome = command
                .wasi_cli_run()
                .call_run(&mut store)
                .map_err(HostError::Runtime)?;
            Ok(match outcome {
                Ok(()) => WasiRunOutcome::Success,
                Err(()) => WasiRunOutcome::GuestFailure,
            })
        })();

        let timed_out = timer.finish();
        match result {
            Err(_) if timed_out => Err(HostError::TimedOut(self.limits.timeout)),
            result => result,
        }
    }
}

pub(crate) struct HostState {
    pub(crate) table: ResourceTable,
    pub(crate) wasi: WasiCtx,
    limits: StoreLimits,
}

impl WasiView for HostState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

pub(crate) fn build_engine() -> Result<Engine> {
    let mut config = Config::new();
    config.wasm_component_model(true);
    config.consume_fuel(true);
    config.epoch_interruption(true);
    Engine::new(&config).map_err(HostError::Runtime)
}

pub(crate) fn build_store(
    engine: &Engine,
    limits: &WasiExecutionLimits,
    policy: &ResolvedWasiPolicy,
) -> Result<Store<HostState>> {
    let wasi = build_wasi_context(limits, policy)?;
    let store_limits = StoreLimitsBuilder::new()
        .memory_size(limits.max_memory_bytes)
        .table_elements(limits.max_table_elements)
        .instances(limits.max_instances)
        .tables(limits.max_tables)
        .memories(limits.max_memories)
        .trap_on_grow_failure(true)
        .build();
    let mut store = Store::new(
        engine,
        HostState {
            table: ResourceTable::new(),
            wasi,
            limits: store_limits,
        },
    );
    store.limiter(|state| &mut state.limits);
    store.set_fuel(limits.fuel).map_err(HostError::Runtime)?;
    store.set_epoch_deadline(1);
    store.epoch_deadline_trap();
    Ok(store)
}

fn build_wasi_context(
    limits: &WasiExecutionLimits,
    policy: &ResolvedWasiPolicy,
) -> Result<WasiCtx> {
    let mut builder = WasiCtxBuilder::new();
    builder
        .allow_tcp(false)
        .allow_udp(false)
        .allow_ip_name_lookup(false)
        .socket_addr_check(|_, _| Box::pin(async { false }))
        .max_random_size(limits.max_random_bytes);

    for preopen in &policy.preopens {
        let (dir_perms, file_perms) = match preopen.access {
            DirectoryAccess::ReadOnly => (DirPerms::READ, FilePerms::READ),
            DirectoryAccess::ReadWrite => (
                DirPerms::READ | DirPerms::MUTATE,
                FilePerms::READ | FilePerms::WRITE,
            ),
        };
        builder
            .preopened_dir(
                &preopen.host_path,
                preopen.guest_path,
                dir_perms,
                file_perms,
            )
            .map_err(HostError::Runtime)?;
    }
    Ok(builder.build())
}

pub(crate) struct ExecutionTimer {
    cancel: mpsc::Sender<()>,
    fired: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl ExecutionTimer {
    pub(crate) fn arm(engine: Engine, timeout: std::time::Duration) -> Result<Self> {
        let (cancel, receiver) = mpsc::channel();
        let fired = Arc::new(AtomicBool::new(false));
        let worker_fired = Arc::clone(&fired);
        let worker = thread::Builder::new()
            .name("lyra-wasi-deadline".to_owned())
            .spawn(move || {
                if receiver.recv_timeout(timeout).is_err() {
                    worker_fired.store(true, Ordering::Release);
                    engine.increment_epoch();
                }
            })
            .map_err(HostError::TimerThread)?;
        Ok(Self {
            cancel,
            fired,
            worker: Some(worker),
        })
    }

    pub(crate) fn finish(mut self) -> bool {
        self.stop();
        self.fired.load(Ordering::Acquire)
    }

    fn stop(&mut self) {
        let _ = self.cancel.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for ExecutionTimer {
    fn drop(&mut self) {
        self.stop();
    }
}
