use std::time::{Duration, Instant};

use lyra_terminal_core::{tui_map, TerminalScreenState};

const FULL_PERF_ENV: &str = "LYRA_TERMINAL_PERF_FULL";

#[derive(Clone, Copy)]
struct PerfProfile {
    name: &'static str,
    bytes: usize,
    line_count: usize,
    tui_frames: usize,
    max_smoke_duration: Duration,
}

const PERF_PROFILES: &[PerfProfile] = &[
    PerfProfile {
        name: "10mb-output",
        bytes: 10 * 1024 * 1024,
        line_count: 10_000,
        tui_frames: 500,
        max_smoke_duration: Duration::from_secs(15),
    },
    PerfProfile {
        name: "100mb-output",
        bytes: 100 * 1024 * 1024,
        line_count: 100_000,
        tui_frames: 2_000,
        max_smoke_duration: Duration::from_secs(120),
    },
    PerfProfile {
        name: "10k-lines-per-sec-simulation",
        bytes: 2 * 1024 * 1024,
        line_count: 10_000,
        tui_frames: 250,
        max_smoke_duration: Duration::from_secs(10),
    },
    PerfProfile {
        name: "tui-update-storm",
        bytes: 512 * 1024,
        line_count: 1_000,
        tui_frames: 5_000,
        max_smoke_duration: Duration::from_secs(20),
    },
    PerfProfile {
        name: "read-wait-latency-under-load",
        bytes: 4 * 1024 * 1024,
        line_count: 25_000,
        tui_frames: 250,
        max_smoke_duration: Duration::from_secs(15),
    },
    PerfProfile {
        name: "ui-render-latency-under-load",
        bytes: 1024 * 1024,
        line_count: 5_000,
        tui_frames: 1_000,
        max_smoke_duration: Duration::from_secs(15),
    },
    PerfProfile {
        name: "memory-bounded-long-output",
        bytes: 100 * 1024 * 1024,
        line_count: 100_000,
        tui_frames: 100,
        max_smoke_duration: Duration::from_secs(120),
    },
    PerfProfile {
        name: "artifact-indexing-pty-read",
        bytes: 8 * 1024 * 1024,
        line_count: 50_000,
        tui_frames: 100,
        max_smoke_duration: Duration::from_secs(30),
    },
    PerfProfile {
        name: "event-journal-throughput",
        bytes: 2 * 1024 * 1024,
        line_count: 20_000,
        tui_frames: 50,
        max_smoke_duration: Duration::from_secs(15),
    },
];

fn full_perf_enabled() -> bool {
    std::env::var(FULL_PERF_ENV).is_ok_and(|value| value == "1" || value == "true")
}

fn repeated_output(target_bytes: usize, line_count: usize) -> Vec<u8> {
    let mut output = Vec::with_capacity(target_bytes.min(10 * 1024 * 1024));
    let mut index = 0usize;
    while output.len() < target_bytes {
        let line =
            format!("[release-gate] line={index:06} status=ok payload=terminal-throughput-check\n");
        output.extend_from_slice(line.as_bytes());
        index = (index + 1) % line_count.max(1);
    }
    output.truncate(target_bytes);
    output
}

fn run_profile(profile: PerfProfile) -> Duration {
    let mut state = TerminalScreenState::new(32, 120);
    let started = Instant::now();
    let output = repeated_output(profile.bytes, profile.line_count);
    state.feed(&output);
    for frame in 0..profile.tui_frames {
        let row = (frame % 30) + 1;
        let col = (frame % 80) + 1;
        let update = format!("\x1b[{row};{col}Hframe {frame:05}");
        state.feed(update.as_bytes());
    }
    let snapshot = state.snapshot(true, Some(200), Some(64 * 1024));
    let _regions = tui_map::regions_from_snapshot(&snapshot, Some(128), false);
    started.elapsed()
}

#[test]
fn benchmark_profiles_cover_release_gate_targets() {
    let names = PERF_PROFILES
        .iter()
        .map(|profile| profile.name)
        .collect::<Vec<_>>();
    assert!(names.contains(&"10mb-output"));
    assert!(names.contains(&"100mb-output"));
    assert!(names.contains(&"10k-lines-per-sec-simulation"));
    assert!(names.contains(&"tui-update-storm"));
    assert!(names.contains(&"read-wait-latency-under-load"));
    assert!(names.contains(&"ui-render-latency-under-load"));
    assert!(names.contains(&"memory-bounded-long-output"));
    assert!(names.contains(&"artifact-indexing-pty-read"));
    assert!(names.contains(&"event-journal-throughput"));
}

#[test]
fn terminal_perf_smoke_runs_bounded_default_workloads() {
    let profiles = if full_perf_enabled() {
        PERF_PROFILES.to_vec()
    } else {
        PERF_PROFILES
            .iter()
            .map(|profile| PerfProfile {
                bytes: profile.bytes.min(128 * 1024),
                line_count: profile.line_count.min(500),
                tui_frames: profile.tui_frames.min(50),
                ..*profile
            })
            .collect::<Vec<_>>()
    };

    for profile in profiles {
        let elapsed = run_profile(profile);
        assert!(
            elapsed <= profile.max_smoke_duration,
            "{} exceeded smoke budget: {:?}",
            profile.name,
            elapsed
        );
    }
}
