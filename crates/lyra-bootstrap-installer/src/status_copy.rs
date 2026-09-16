use lyra_bootstrap_core::InstallProgressPhase;

pub const EXIT_MS: u64 = 280;
pub const ENTER_MS: u64 = 360;
pub const ROTATE_MS: u64 = 1_200;
pub const LINE_HEIGHT: f32 = 14.0;
const MAX_GLYPHS: usize = 42;

const IDLE: &[&str] = &[
    "Catalog URL is pinned in this build",
    "Trust roots are already in the installer",
    "Component payloads stay on HTTPS",
    "Interrupted downloads can resume later",
];

const CATALOG: &[&str] = &[
    "Fetching the signed release catalog",
    "Authenticating the catalog signature",
    "Reading the channel sequence number",
];

const BOM: &[&str] = &[
    "Loading the bill of materials",
    "Verifying the BOM signature",
    "Selecting the exact component set",
];

const DOWNLOAD_WAIT: &[&str] = &[
    "Opening the component download session",
    "Waiting for the first payload bytes",
    "Keeping the TLS session warm",
];

const VERIFY: &[&str] = &[
    "Checking the SHA-256 digest",
    "Verifying the component signature",
    "Rejecting anything that does not match",
];

const INSTALL: &[&str] = &[
    "Staging files into a temporary tree",
    "Activating the verified payload",
    "Projecting Core into the program root",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MotionKind {
    Idle,
    Exit,
    Enter,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphFrame {
    pub glyph: String,
    pub offset_y: f32,
    pub opacity: f32,
}

#[derive(Debug)]
pub struct StatusRotator {
    displayed: String,
    incoming: Option<String>,
    kind: MotionKind,
    kind_started_ms: u64,
    last_rotate_ms: u64,
    pool: Vec<String>,
    index: usize,
    frozen: bool,
}

impl StatusRotator {
    pub fn new(now_ms: u64) -> Self {
        let pool = idle_pool();
        let displayed = pool[0].clone();
        Self {
            displayed,
            incoming: None,
            kind: MotionKind::Idle,
            kind_started_ms: now_ms,
            last_rotate_ms: now_ms,
            pool,
            index: 0,
            frozen: false,
        }
    }

    pub fn set_pool(&mut self, pool: Vec<String>, now_ms: u64) {
        if pool.is_empty() {
            return;
        }
        if self.pool == pool {
            return;
        }
        self.pool = pool;
        self.index = 0;
        self.frozen = false;
        self.begin_exit(self.pool[0].clone(), now_ms);
    }

    pub fn show_static(&mut self, text: String, now_ms: u64) {
        self.frozen = true;
        self.pool = vec![text.clone()];
        self.index = 0;
        if text == self.displayed && self.kind == MotionKind::Idle {
            return;
        }
        self.begin_exit(text, now_ms);
    }

    pub fn tick(&mut self, now_ms: u64) -> Vec<GlyphFrame> {
        match self.kind {
            MotionKind::Idle => {
                if !self.frozen
                    && self.pool.len() > 1
                    && now_ms.saturating_sub(self.last_rotate_ms) >= ROTATE_MS
                {
                    let next = (self.index + 1) % self.pool.len();
                    self.index = next;
                    self.begin_exit(self.pool[next].clone(), now_ms);
                }
            }
            MotionKind::Exit => {
                let chars = grapheme_len(&self.displayed);
                let duration = EXIT_MS
                    + char_delay_ms(chars, EXIT_MS).saturating_mul(chars.saturating_sub(1) as u64);
                if now_ms.saturating_sub(self.kind_started_ms) >= duration {
                    if let Some(incoming) = self.incoming.take() {
                        self.displayed = incoming;
                    }
                    self.kind = MotionKind::Enter;
                    self.kind_started_ms = now_ms;
                }
            }
            MotionKind::Enter => {
                let chars = grapheme_len(&self.displayed);
                let duration = ENTER_MS
                    + char_delay_ms(chars, ENTER_MS).saturating_mul(chars.saturating_sub(1) as u64);
                if now_ms.saturating_sub(self.kind_started_ms) >= duration {
                    self.kind = MotionKind::Idle;
                    self.kind_started_ms = now_ms;
                    self.last_rotate_ms = now_ms;
                }
            }
        }

        let (duration, elapsed) = match self.kind {
            MotionKind::Idle => (0, 0),
            MotionKind::Exit => (EXIT_MS, now_ms.saturating_sub(self.kind_started_ms)),
            MotionKind::Enter => (ENTER_MS, now_ms.saturating_sub(self.kind_started_ms)),
        };
        glyphs_for(&self.displayed, self.kind, elapsed, duration)
    }
}

pub fn pool_for_phase(phase: InstallProgressPhase, component: Option<&str>) -> Vec<String> {
    match phase {
        InstallProgressPhase::Catalog => pool_strings(CATALOG),
        InstallProgressPhase::Bom => pool_strings(BOM),
        InstallProgressPhase::Download => download_pool(component),
        InstallProgressPhase::Verify => pool_strings(VERIFY),
        InstallProgressPhase::Install => pool_strings(INSTALL),
        InstallProgressPhase::Complete => vec!["Lyra is ready".to_string()],
    }
}

pub fn idle_pool() -> Vec<String> {
    pool_strings(IDLE)
}

pub fn char_delay_ms(total_chars: usize, duration_ms: u64) -> u64 {
    if total_chars <= 1 {
        return 0;
    }
    let available = (duration_ms as f64) * 0.55;
    let ideal = available / total_chars as f64;
    ideal.clamp(6.0, 32.0) as u64
}

pub fn format_speed_bps(bps: f64) -> String {
    if !bps.is_finite() || bps < 1.0 {
        return String::new();
    }
    if bps < 1024.0 {
        return format!("{:.0} B/s", bps);
    }
    let kib = bps / 1024.0;
    if kib < 1024.0 {
        return format!("{:.1} KB/s", kib);
    }
    format!("{:.1} MB/s", kib / 1024.0)
}

pub fn format_percent(fraction: f32) -> String {
    if !fraction.is_finite() {
        return String::new();
    }
    format!("{}%", (fraction.clamp(0.0, 1.0) * 100.0).round() as u32)
}

pub fn elide_install_path(path: &str, max_chars: usize) -> String {
    let chars: Vec<char> = path.chars().collect();
    if chars.len() <= max_chars {
        return path.to_string();
    }
    if max_chars <= 8 {
        return chars.into_iter().take(max_chars).collect();
    }
    let keep_end = ((max_chars / 2) - 1).max(4);
    let keep_start = max_chars.saturating_sub(keep_end + 1);
    let mut out: String = chars[..keep_start].iter().collect();
    out.push('…');
    out.extend(chars[chars.len() - keep_end..].iter());
    out
}

#[derive(Debug, Default)]
pub struct SpeedEstimator {
    last_completed: u64,
    last_ms: Option<u64>,
    ema: f64,
}

impl SpeedEstimator {
    pub fn update(&mut self, completed: u64, now_ms: u64) -> f64 {
        let Some(last_ms) = self.last_ms else {
            self.last_completed = completed;
            self.last_ms = Some(now_ms);
            return 0.0;
        };
        let dt_ms = now_ms.saturating_sub(last_ms);
        if dt_ms >= 80 && completed >= self.last_completed {
            let inst = (completed - self.last_completed) as f64 / (dt_ms as f64 / 1000.0);
            self.ema = if self.ema <= 0.0 {
                inst
            } else {
                self.ema * 0.72 + inst * 0.28
            };
            self.last_completed = completed;
            self.last_ms = Some(now_ms);
        }
        self.ema
    }
}

fn download_pool(component: Option<&str>) -> Vec<String> {
    match component.map(str::trim).filter(|value| !value.is_empty()) {
        Some(component) => vec![
            format!("Downloading {component}"),
            format!("Resuming {component} from checkpoint"),
            format!("Writing {component} into staging"),
        ],
        None => pool_strings(DOWNLOAD_WAIT),
    }
}

fn pool_strings(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|line| (*line).to_string()).collect()
}

fn grapheme_len(text: &str) -> usize {
    text.chars().count().min(MAX_GLYPHS)
}

fn glyphs_for(text: &str, kind: MotionKind, elapsed_ms: u64, duration_ms: u64) -> Vec<GlyphFrame> {
    let chars: Vec<char> = text.chars().take(MAX_GLYPHS).collect();
    let delay = char_delay_ms(chars.len(), duration_ms);
    chars
        .into_iter()
        .enumerate()
        .map(|(index, ch)| {
            let local = elapsed_ms.saturating_sub(index as u64 * delay);
            let t = if duration_ms == 0 {
                1.0
            } else {
                (local as f32 / duration_ms as f32).clamp(0.0, 1.0)
            };
            let (offset_y, opacity) = match kind {
                MotionKind::Idle => (0.0, 1.0),
                MotionKind::Exit => (-LINE_HEIGHT * t, 1.0 - t),
                MotionKind::Enter => (LINE_HEIGHT * (1.0 - t), t),
            };
            GlyphFrame {
                glyph: ch.to_string(),
                offset_y,
                opacity,
            }
        })
        .collect()
}

impl StatusRotator {
    fn begin_exit(&mut self, incoming: String, now_ms: u64) {
        if incoming == self.displayed && self.kind == MotionKind::Idle {
            return;
        }
        self.incoming = Some(incoming);
        self.kind = MotionKind::Exit;
        self.kind_started_ms = now_ms;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_phase_pool_is_nonempty_english() {
        let phases = [
            InstallProgressPhase::Catalog,
            InstallProgressPhase::Bom,
            InstallProgressPhase::Download,
            InstallProgressPhase::Verify,
            InstallProgressPhase::Install,
            InstallProgressPhase::Complete,
        ];
        for phase in phases {
            let pool = pool_for_phase(phase, Some("lyra.core"));
            assert!(!pool.is_empty(), "{phase:?} pool");
            for line in &pool {
                assert!(!line.is_empty());
                assert!(line.is_ascii(), "{line}");
                assert!(
                    !line
                        .chars()
                        .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch)),
                    "{line}"
                );
            }
        }
        assert!(!idle_pool().is_empty());
    }

    #[test]
    fn char_delay_matches_titlebar_bounds() {
        assert_eq!(char_delay_ms(1, EXIT_MS), 0);
        let delay = char_delay_ms(20, EXIT_MS);
        assert!((6..=32).contains(&delay), "{delay}");
    }

    #[test]
    fn rotator_advances_after_rotate_interval() {
        let mut rotator = StatusRotator::new(0);
        let first = rotator.displayed.clone();
        let _ = rotator.tick(ROTATE_MS);
        assert_eq!(rotator.kind, MotionKind::Exit);
        assert_ne!(rotator.incoming.as_deref(), Some(first.as_str()));
    }

    #[test]
    fn speed_and_percent_format_stable_values() {
        assert_eq!(format_speed_bps(800.0), "800 B/s");
        assert_eq!(format_percent(0.372), "37%");
        let mut estimator = SpeedEstimator::default();
        assert_eq!(estimator.update(0, 0), 0.0);
        let speed = estimator.update(1_024_000, 1_000);
        assert!(speed > 900_000.0, "{speed}");
    }

    #[test]
    fn elide_keeps_drive_and_leaf() {
        let path = r"D:\Very\Long\Windows\Path\Lyra";
        let elided = elide_install_path(path, 18);
        assert!(elided.starts_with('D'), "{elided}");
        assert!(elided.ends_with("Lyra"), "{elided}");
        assert!(elided.contains('…'), "{elided}");
    }
}
