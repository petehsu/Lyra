use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::io::{self, Write};
use std::path::Path;
use std::time::{Duration, Instant};

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const ITALIC: &str = "\x1b[3m";
const STRIKE: &str = "\x1b[9m";
const CYAN: &str = "\x1b[36m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const MAGENTA: &str = "\x1b[35m";

#[derive(Debug)]
pub struct LoadingSpinner {
    frame: usize,
    visible: bool,
    last_tick: Instant,
}

impl LoadingSpinner {
    pub fn new() -> Self {
        Self {
            frame: 0,
            visible: false,
            last_tick: Instant::now() - Duration::from_secs(1),
        }
    }

    pub fn tick(&mut self) -> Result<(), String> {
        if self.visible && self.last_tick.elapsed() < Duration::from_millis(100) {
            return Ok(());
        }
        self.last_tick = Instant::now();
        print!("\r\x1b[2K{}", loading_frame(self.frame));
        io::stdout().flush().map_err(|error| error.to_string())?;
        self.visible = true;
        self.frame = self.frame.wrapping_add(1);
        Ok(())
    }

    pub fn clear(&mut self) -> Result<(), String> {
        if !self.visible {
            return Ok(());
        }
        print!("\r\x1b[2K");
        io::stdout().flush().map_err(|error| error.to_string())?;
        self.visible = false;
        Ok(())
    }
}

pub fn loading_frame(frame: usize) -> String {
    const FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    format!("{DIM}╭─ assistant {}{RESET}", FRAMES[frame % FRAMES.len()])
}

pub fn render_welcome_block(session_id: &str, cwd: &Path) -> String {
    format!(
        "{DIM}╭─ Lyra Agent CLI\n│ session {session_id}\n│ cwd {}\n│ / controls · verified commands run in shell\n╰─{RESET}\n",
        cwd.display()
    )
}

pub fn render_input_prompt(cwd: &Path) -> String {
    format!("\n{DIM}╭─ {}\n╰─{RESET} {BOLD}❯{RESET} ", cwd.display())
}

pub fn render_follow_command_prompt(cwd: Option<&str>, command: &str) -> String {
    let cwd = cwd.map(str::trim).filter(|value| !value.is_empty());
    format!(
        "\n{DIM}╭─ {}\n╰─{RESET} {BOLD}❯{RESET} {YELLOW}{command}{RESET}\n",
        cwd.unwrap_or("agent")
    )
}

pub fn render_follow_command_result(
    output: Option<&str>,
    exit_code: Option<i64>,
    truncated: bool,
) -> String {
    let mut rendered = String::new();
    if let Some(output) = output.map(str::trim).filter(|value| !value.is_empty()) {
        rendered.push_str(output);
        if !rendered.ends_with('\n') {
            rendered.push('\n');
        }
    }
    let status = match exit_code {
        Some(code) => format!("exit {code}"),
        None => "done".to_string(),
    };
    let suffix = if truncated { " · truncated" } else { "" };
    rendered.push_str(&format!("{DIM}╰─ shell {status}{suffix}{RESET}\n"));
    rendered
}

pub fn render_agent_response_block(content: &str) -> String {
    let body = render_agent_markdown(content);
    format!("{DIM}╭─ assistant{RESET}\n{body}{DIM}╰─{RESET}\n")
}

pub fn render_control_menu_block(follow_enabled: bool) -> String {
    format!(
        "{DIM}╭─ controls\n│ /follow  {}\n╰─{RESET}\n",
        if follow_enabled { "on" } else { "off" }
    )
}

pub fn render_status_block(kind: &str, text: &str) -> String {
    format!("{DIM}╭─ {kind}\n│ {YELLOW}{text}{RESET}{DIM}\n╰─{RESET}\n")
}

pub fn render_permission_prompt(title: &str, detail: Option<&str>) -> String {
    let detail = detail.map(str::trim).filter(|value| !value.is_empty());
    let detail_line = detail
        .map(|value| format!("{DIM}│ {value}\n"))
        .unwrap_or_default();
    format!(
        "{DIM}╭─ permission\n│ {YELLOW}{title}{RESET}\n{detail_line}{DIM}╰─ allow? {BOLD}y{RESET}{DIM}/{BOLD}N{RESET}{DIM} {RESET}"
    )
}

pub fn render_permission_decision(allowed: bool) -> String {
    format!(
        "\n{DIM}╰─ permission {}{RESET}\n",
        if allowed { "allowed" } else { "denied" }
    )
}

pub fn render_shell_result_line(exit_code: i32, duration: Duration) -> String {
    let status_color = if exit_code == 0 { GREEN } else { YELLOW };
    format!(
        "\n{DIM}╰─ shell {status_color}exit {exit_code}{RESET}{DIM} · {}{RESET}\n",
        format_duration(duration)
    )
}

pub fn render_agent_markdown(content: &str) -> String {
    let cleaned = fix_common_markdown_issues(content);
    let mut renderer = MarkdownRenderer::default();
    renderer.render(&cleaned);
    renderer.finish()
}

pub fn render_tool_line(name: &str, status: Option<&str>) -> String {
    match status {
        Some(status) => format!("{DIM}• tool{RESET} {CYAN}{name}{RESET}{DIM} {status}{RESET}\n"),
        None => format!("{DIM}• tool{RESET} {CYAN}{name}{RESET}{DIM} running{RESET}\n"),
    }
}

pub fn render_notice(kind: &str, text: &str) -> String {
    render_status_block(kind, text)
}

fn format_duration(duration: Duration) -> String {
    if duration < Duration::from_secs(1) {
        format!("{}ms", duration.as_millis())
    } else if duration < Duration::from_secs(60) {
        format!("{:.1}s", duration.as_secs_f32())
    } else {
        let minutes = duration.as_secs() / 60;
        let seconds = duration.as_secs() % 60;
        format!("{minutes}m {seconds}s")
    }
}

fn fix_common_markdown_issues(content: &str) -> String {
    let mut result = content.replace('｜', "|");
    let fence_count = result
        .lines()
        .filter(|line| line.trim_start().starts_with("```"))
        .count();
    if fence_count % 2 != 0 {
        result.push_str("\n```");
    }
    if result.matches("**").count() % 2 != 0 {
        result.push_str("**");
    }
    result
}

#[derive(Debug, Default)]
struct MarkdownRenderer {
    output: String,
    list_stack: Vec<ListState>,
    code_block: Option<CodeBlock>,
    link_destination: Option<String>,
    line_start: bool,
}

#[derive(Debug)]
struct ListState {
    next_number: Option<u64>,
}

#[derive(Debug)]
struct CodeBlock {
    language: Option<String>,
    body: String,
}

impl MarkdownRenderer {
    fn render(&mut self, content: &str) {
        let mut options = Options::empty();
        options.insert(Options::ENABLE_STRIKETHROUGH);
        options.insert(Options::ENABLE_TABLES);
        options.insert(Options::ENABLE_TASKLISTS);
        for event in Parser::new_ext(content, options) {
            self.handle_event(event);
        }
    }

    fn finish(mut self) -> String {
        self.trim_trailing_blank_lines();
        self.output.push('\n');
        self.output
    }

    fn handle_event(&mut self, event: Event<'_>) {
        if self.code_block.is_some() {
            self.handle_code_block_event(event);
            return;
        }

        match event {
            Event::Start(tag) => self.handle_start(tag),
            Event::End(tag) => self.handle_end(tag),
            Event::Text(text) => self.push_text(&text),
            Event::Code(code) => {
                self.output.push_str(CYAN);
                self.output.push('`');
                self.output.push_str(&code);
                self.output.push('`');
                self.output.push_str(RESET);
                self.line_start = false;
            }
            Event::SoftBreak => self.output.push(' '),
            Event::HardBreak => self.newline(),
            Event::Rule => {
                self.ensure_blank_line();
                self.output.push_str(DIM);
                self.output.push_str("────────────────────────");
                self.output.push_str(RESET);
                self.ensure_blank_line();
            }
            Event::Html(html) | Event::InlineHtml(html) => self.push_text(&html),
            Event::FootnoteReference(reference) => {
                self.output.push('[');
                self.output.push_str(&reference);
                self.output.push(']');
                self.line_start = false;
            }
            Event::TaskListMarker(checked) => {
                self.output.push_str(if checked { "[x] " } else { "[ ] " });
                self.line_start = false;
            }
        }
    }

    fn handle_start(&mut self, tag: Tag<'_>) {
        match tag {
            Tag::Paragraph => {}
            Tag::Heading { level, .. } => {
                self.ensure_blank_line();
                self.output.push_str(MAGENTA);
                self.output.push_str(BOLD);
                self.output.push_str(&"#".repeat(level as usize));
                self.output.push(' ');
                self.line_start = false;
            }
            Tag::Strong => self.output.push_str(BOLD),
            Tag::Emphasis => self.output.push_str(ITALIC),
            Tag::Strikethrough => self.output.push_str(STRIKE),
            Tag::BlockQuote => {
                self.ensure_blank_line();
                self.output.push_str(DIM);
                self.output.push_str("> ");
                self.output.push_str(RESET);
                self.line_start = false;
            }
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(language) if !language.is_empty() => {
                        Some(language.to_string())
                    }
                    _ => None,
                };
                self.code_block = Some(CodeBlock {
                    language,
                    body: String::new(),
                });
            }
            Tag::List(start) => {
                self.ensure_blank_line();
                self.list_stack.push(ListState { next_number: start });
            }
            Tag::Item => {
                if !self.line_start {
                    self.newline();
                }
                let indent = "  ".repeat(self.list_stack.len().saturating_sub(1));
                self.output.push_str(&indent);
                if let Some(list) = self.list_stack.last_mut() {
                    if let Some(number) = list.next_number.as_mut() {
                        self.output.push_str(&format!("{number}. "));
                        *number += 1;
                    } else {
                        self.output.push_str("• ");
                    }
                } else {
                    self.output.push_str("• ");
                }
                self.line_start = false;
            }
            Tag::Link { dest_url, .. } => {
                self.link_destination = Some(dest_url.to_string());
                self.output.push_str(CYAN);
            }
            Tag::Table(_alignments) => self.ensure_blank_line(),
            Tag::TableHead | Tag::TableRow => {
                if !self.line_start {
                    self.newline();
                }
            }
            Tag::TableCell => {
                if !self.line_start {
                    self.output.push_str(DIM);
                    self.output.push_str(" │ ");
                    self.output.push_str(RESET);
                }
            }
            Tag::Image {
                dest_url, title, ..
            } => {
                self.output.push_str(CYAN);
                self.output.push_str("[image");
                if !title.is_empty() {
                    self.output.push_str(": ");
                    self.output.push_str(&title);
                }
                self.output.push_str("](");
                self.output.push_str(&dest_url);
                self.output.push(')');
                self.output.push_str(RESET);
                self.line_start = false;
            }
            _ => {}
        }
    }

    fn handle_end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph => self.ensure_blank_line(),
            TagEnd::Heading(_) => {
                self.output.push_str(RESET);
                self.ensure_blank_line();
            }
            TagEnd::Strong | TagEnd::Emphasis | TagEnd::Strikethrough => {
                self.output.push_str(RESET);
            }
            TagEnd::BlockQuote => self.ensure_blank_line(),
            TagEnd::List(_) => {
                self.list_stack.pop();
                if self.list_stack.is_empty() {
                    self.ensure_blank_line();
                }
            }
            TagEnd::Item => self.newline(),
            TagEnd::CodeBlock => {
                if let Some(block) = self.code_block.take() {
                    self.render_code_block(block);
                }
            }
            TagEnd::Link => {
                self.output.push_str(RESET);
                if let Some(destination) = self.link_destination.take() {
                    self.output.push_str(DIM);
                    self.output.push_str(" <");
                    self.output.push_str(&destination);
                    self.output.push('>');
                    self.output.push_str(RESET);
                }
                self.line_start = false;
            }
            TagEnd::Table | TagEnd::TableHead | TagEnd::TableRow => self.newline(),
            TagEnd::TableCell => {}
            _ => {}
        }
    }

    fn handle_code_block_event(&mut self, event: Event<'_>) {
        match event {
            Event::End(TagEnd::CodeBlock) => {
                if let Some(block) = self.code_block.take() {
                    self.render_code_block(block);
                }
            }
            Event::Text(text) | Event::Code(text) | Event::Html(text) | Event::InlineHtml(text) => {
                if let Some(block) = self.code_block.as_mut() {
                    block.body.push_str(&text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some(block) = self.code_block.as_mut() {
                    block.body.push('\n');
                }
            }
            _ => {}
        }
    }

    fn render_code_block(&mut self, block: CodeBlock) {
        self.ensure_blank_line();
        let language = block.language.as_deref().unwrap_or("code");
        self.output.push_str(DIM);
        self.output.push_str("╭─ ");
        self.output.push_str(language);
        self.output.push('\n');
        self.output.push_str(RESET);
        for line in block.body.trim_end_matches('\n').lines() {
            self.output.push_str(DIM);
            self.output.push_str("│ ");
            self.output.push_str(RESET);
            self.output.push_str(GREEN);
            self.output.push_str(line);
            self.output.push_str(RESET);
            self.output.push('\n');
        }
        self.output.push_str(DIM);
        self.output.push_str("╰─");
        self.output.push_str(RESET);
        self.ensure_blank_line();
    }

    fn push_text(&mut self, text: &str) {
        self.output.push_str(text);
        if !text.is_empty() {
            self.line_start = text.ends_with('\n');
        }
    }

    fn newline(&mut self) {
        if !self.output.ends_with('\n') {
            self.output.push('\n');
        }
        self.line_start = true;
    }

    fn ensure_blank_line(&mut self) {
        self.trim_trailing_spaces();
        if self.output.is_empty() {
            self.line_start = true;
            return;
        }
        if !self.output.ends_with('\n') {
            self.output.push('\n');
        }
        if !self.output.ends_with("\n\n") {
            self.output.push('\n');
        }
        self.line_start = true;
    }

    fn trim_trailing_spaces(&mut self) {
        while self.output.ends_with(' ') || self.output.ends_with('\t') {
            self.output.pop();
        }
    }

    fn trim_trailing_blank_lines(&mut self) {
        while self.output.ends_with('\n') {
            self.output.pop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strip_ansi(value: &str) -> String {
        let mut output = String::new();
        let mut chars = value.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '\x1b' && chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
                continue;
            }
            output.push(ch);
        }
        output
    }

    #[test]
    fn loading_frame_matches_panel_braille_spinner() {
        let plain = strip_ansi(&loading_frame(0));
        assert!(plain.contains("╭─ assistant"));
        assert!(loading_frame(0).contains("⠋"));
        assert!(loading_frame(1).contains("⠙"));
        assert!(loading_frame(2).contains("⠹"));
        assert!(loading_frame(9).contains("⠏"));
        assert!(loading_frame(10).contains("⠋"));
    }

    #[test]
    fn markdown_rendering_adds_terminal_structure() {
        let rendered = render_agent_markdown(
            "# Title\n\n- one\n- `two`\n\n```sh\necho ok\n```\n\n[site](https://example.com)",
        );
        let plain = strip_ansi(&rendered);
        assert!(plain.contains("# Title"));
        assert!(plain.contains("• one"));
        assert!(plain.contains("`two`"));
        assert!(plain.contains("╭─ sh"));
        assert!(plain.contains("│ echo ok"));
        assert!(plain.contains("site <https://example.com>"));
    }

    #[test]
    fn markdown_rendering_repairs_unclosed_code_fence() {
        let rendered = render_agent_markdown("```rust\nlet x = 1;");
        let plain = strip_ansi(&rendered);
        assert!(plain.contains("╭─ rust"));
        assert!(plain.contains("│ let x = 1;"));
    }

    #[test]
    fn input_prompt_is_a_bottom_block_boundary() {
        let rendered = render_input_prompt(Path::new("/tmp/project"));
        let plain = strip_ansi(&rendered);
        assert!(plain.contains("╭─ /tmp/project"));
        assert!(plain.ends_with("❯ "));
    }

    #[test]
    fn agent_response_wraps_rich_markdown_in_block() {
        let rendered = render_agent_response_block("hello **world**");
        let plain = strip_ansi(&rendered);
        assert!(plain.starts_with("╭─ assistant\n"));
        assert!(plain.contains("hello world"));
        assert!(plain.ends_with("╰─\n"));
    }

    #[test]
    fn control_menu_and_shell_footer_are_structured() {
        let controls = strip_ansi(&render_control_menu_block(true));
        assert!(controls.contains("╭─ controls"));
        assert!(controls.contains("/follow  on"));

        let footer = strip_ansi(&render_shell_result_line(0, Duration::from_millis(42)));
        assert!(footer.contains("╰─ shell exit 0 · 42ms"));
    }

    #[test]
    fn tool_line_is_compact_single_line() {
        let running = strip_ansi(&render_tool_line("workbench", None));
        assert_eq!(running, "• tool workbench running\n");

        let finished = strip_ansi(&render_tool_line("workbench", Some("completed")));
        assert_eq!(finished, "• tool workbench completed\n");
    }

    #[test]
    fn follow_command_blocks_look_like_user_commands() {
        let prompt = strip_ansi(&render_follow_command_prompt(
            Some("/Users/petehsu"),
            "ls -la",
        ));
        assert_eq!(prompt, "\n╭─ /Users/petehsu\n╰─ ❯ ls -la\n");

        let result = strip_ansi(&render_follow_command_result(Some("ok\n"), Some(0), false));
        assert_eq!(result, "ok\n╰─ shell exit 0\n");
    }

    #[test]
    fn permission_prompt_requests_a_cli_decision() {
        let prompt = strip_ansi(&render_permission_prompt(
            "Run shell command",
            Some("terminal.run command=cd Documents"),
        ));
        assert!(prompt.contains("╭─ permission"));
        assert!(prompt.contains("Run shell command"));
        assert!(prompt.contains("terminal.run command=cd Documents"));
        assert!(prompt.ends_with("╰─ allow? y/N "));
    }
}
