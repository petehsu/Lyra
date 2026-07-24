pub mod engine;
pub mod osint;
pub mod signals;
pub mod types;

pub use engine::compute_persona;
pub use osint::run_osint_scan;
pub use signals::{DesktopSignals, collect_local_signals};
pub use types::{
    ComputedPersona, OsintCluster, OsintHit, OsintProfile, PlatformIdentity, SignalBundle,
    SignalConsensus,
};
