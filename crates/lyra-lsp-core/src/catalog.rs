//! Language-server catalog. Data, not per-language spawn scripts.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AcquireKind {
    Path,
    Component,
    Npm,
    GithubRelease,
    GoInstall,
    DotnetTool,
    Gem,
}

#[derive(Clone, Copy, Debug)]
pub struct ServerEntry {
    pub id: &'static str,
    pub language_ids: &'static [&'static str],
    pub extensions: &'static [&'static str],
    pub root_markers: &'static [&'static str],
    pub program: &'static str,
    pub args: &'static [&'static str],
    pub env_program: Option<&'static str>,
    pub acquire: AcquireKind,
    pub npm_package: Option<&'static str>,
    pub npm_bin: Option<&'static str>,
    pub pin_version: Option<&'static str>,
    pub github_repo: Option<&'static str>,
    pub go_package: Option<&'static str>,
    pub dotnet_package: Option<&'static str>,
    pub gem_package: Option<&'static str>,
    pub primary: bool,
}

const STDIO: &[&str] = &["--stdio"];
const EMPTY_ARGS: &[&str] = &[];
const RUBY_ARGS: &[&str] = &["--lsp"];
const DENO_ARGS: &[&str] = &["lsp"];
const BIOME_ARGS: &[&str] = &["lsp-proxy"];
const DART_ARGS: &[&str] = &["language-server", "--lsp"];
const PRISMA_ARGS: &[&str] = &["language-server"];
const GLEAM_ARGS: &[&str] = &["lsp"];
const PYRIGHT_ARGS: &[&str] = &["--stdio"];
const TY_ARGS: &[&str] = &["server"];

pub static SERVERS: &[ServerEntry] = &[
    ServerEntry {
        id: "typescript",
        language_ids: &["typescript", "javascript", "ts", "js"],
        extensions: &[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
        root_markers: &[
            "package.json",
            "tsconfig.json",
            "jsconfig.json",
            "pnpm-lock.yaml",
        ],
        program: "typescript-language-server",
        args: STDIO,
        env_program: Some("LYRA_LSP_TYPESCRIPT_SERVER"),
        acquire: AcquireKind::Npm,
        npm_package: Some("typescript-language-server"),
        npm_bin: Some("typescript-language-server"),
        pin_version: Some("4.3.3"),
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "pyright",
        language_ids: &["python", "py"],
        extensions: &[".py", ".pyi"],
        root_markers: &["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"],
        program: "pyright-langserver",
        args: PYRIGHT_ARGS,
        env_program: Some("LYRA_LSP_PYRIGHT"),
        acquire: AcquireKind::Npm,
        npm_package: Some("pyright"),
        npm_bin: Some("pyright-langserver"),
        pin_version: Some("1.1.401"),
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "rust",
        language_ids: &["rust", "rs"],
        extensions: &[".rs"],
        root_markers: &["Cargo.toml"],
        program: "rust-analyzer",
        args: EMPTY_ARGS,
        env_program: Some("LYRA_LSP_RUST_ANALYZER"),
        acquire: AcquireKind::Component,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "gopls",
        language_ids: &["go"],
        extensions: &[".go"],
        root_markers: &["go.mod", "go.work"],
        program: "gopls",
        args: EMPTY_ARGS,
        env_program: Some("LYRA_LSP_GOPLS"),
        acquire: AcquireKind::GoInstall,
        npm_package: None,
        npm_bin: None,
        pin_version: Some("v0.18.1"),
        github_repo: None,
        go_package: Some("golang.org/x/tools/gopls"),
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "vue",
        language_ids: &["vue"],
        extensions: &[".vue"],
        root_markers: &["package.json"],
        program: "vue-language-server",
        args: STDIO,
        env_program: None,
        acquire: AcquireKind::Npm,
        npm_package: Some("@vue/language-server"),
        npm_bin: Some("vue-language-server"),
        pin_version: Some("2.2.10"),
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "svelte",
        language_ids: &["svelte"],
        extensions: &[".svelte"],
        root_markers: &["package.json"],
        program: "svelteserver",
        args: STDIO,
        env_program: None,
        acquire: AcquireKind::Npm,
        npm_package: Some("svelte-language-server"),
        npm_bin: Some("svelteserver"),
        pin_version: Some("0.17.19"),
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "astro",
        language_ids: &["astro"],
        extensions: &[".astro"],
        root_markers: &["package.json"],
        program: "astro-ls",
        args: STDIO,
        env_program: None,
        acquire: AcquireKind::Npm,
        npm_package: Some("@astrojs/language-server"),
        npm_bin: Some("astro-ls"),
        pin_version: Some("2.15.4"),
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "yaml",
        language_ids: &["yaml"],
        extensions: &[".yaml", ".yml"],
        root_markers: &[],
        program: "yaml-language-server",
        args: STDIO,
        env_program: None,
        acquire: AcquireKind::Npm,
        npm_package: Some("yaml-language-server"),
        npm_bin: Some("yaml-language-server"),
        pin_version: Some("1.17.0"),
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "bash",
        language_ids: &["shell", "bash", "sh"],
        extensions: &[".sh", ".bash", ".zsh"],
        root_markers: &[],
        program: "bash-language-server",
        args: STDIO,
        env_program: None,
        acquire: AcquireKind::Npm,
        npm_package: Some("bash-language-server"),
        npm_bin: Some("bash-language-server"),
        pin_version: Some("5.4.3"),
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "dockerfile",
        language_ids: &["dockerfile"],
        extensions: &[".dockerfile"],
        root_markers: &["Dockerfile"],
        program: "docker-langserver",
        args: STDIO,
        env_program: None,
        acquire: AcquireKind::Npm,
        npm_package: Some("dockerfile-language-server-nodejs"),
        npm_bin: Some("docker-langserver"),
        pin_version: Some("0.13.0"),
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "php",
        language_ids: &["php"],
        extensions: &[".php"],
        root_markers: &["composer.json"],
        program: "intelephense",
        args: STDIO,
        env_program: None,
        acquire: AcquireKind::Npm,
        npm_package: Some("intelephense"),
        npm_bin: Some("intelephense"),
        pin_version: Some("1.14.4"),
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "clangd",
        language_ids: &["c", "cpp"],
        extensions: &[".c", ".h", ".cc", ".cpp", ".cxx", ".hpp"],
        root_markers: &["compile_commands.json", "CMakeLists.txt", "Makefile"],
        program: "clangd",
        args: EMPTY_ARGS,
        env_program: Some("LYRA_LSP_CLANGD"),
        acquire: AcquireKind::GithubRelease,
        npm_package: None,
        npm_bin: None,
        pin_version: Some("18.1.3"),
        github_repo: Some("clangd/clangd"),
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "lua",
        language_ids: &["lua"],
        extensions: &[".lua"],
        root_markers: &[".luarc.json", ".luacheckrc"],
        program: "lua-language-server",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::GithubRelease,
        npm_package: None,
        npm_bin: None,
        pin_version: Some("3.13.6"),
        github_repo: Some("LuaLS/lua-language-server"),
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "zls",
        language_ids: &["zig"],
        extensions: &[".zig", ".zon"],
        root_markers: &["build.zig"],
        program: "zls",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::GithubRelease,
        npm_package: None,
        npm_bin: None,
        pin_version: Some("0.13.0"),
        github_repo: Some("zigtools/zls"),
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "terraform",
        language_ids: &["terraform"],
        extensions: &[".tf", ".tfvars"],
        root_markers: &[],
        program: "terraform-ls",
        args: STDIO,
        env_program: None,
        acquire: AcquireKind::GithubRelease,
        npm_package: None,
        npm_bin: None,
        pin_version: Some("v0.36.4"),
        github_repo: Some("hashicorp/terraform-ls"),
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "kotlin",
        language_ids: &["kotlin"],
        extensions: &[".kt", ".kts"],
        root_markers: &["settings.gradle", "settings.gradle.kts", "build.gradle.kts"],
        program: "kotlin-lsp",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::GithubRelease,
        npm_package: None,
        npm_bin: None,
        pin_version: Some("0.253.10629"),
        github_repo: Some("Kotlin/kotlin-lsp"),
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "tinymist",
        language_ids: &["typst"],
        extensions: &[".typ"],
        root_markers: &[],
        program: "tinymist",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::GithubRelease,
        npm_package: None,
        npm_bin: None,
        pin_version: Some("v0.13.12"),
        github_repo: Some("Myriad-Dreamin/tinymist"),
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "texlab",
        language_ids: &["tex", "latex"],
        extensions: &[".tex", ".sty"],
        root_markers: &[],
        program: "texlab",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::GithubRelease,
        npm_package: None,
        npm_bin: None,
        pin_version: Some("v5.22.1"),
        github_repo: Some("latex-lsp/texlab"),
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "csharp",
        language_ids: &["csharp"],
        extensions: &[".cs"],
        root_markers: &[".sln", ".csproj", "global.json"],
        program: "roslyn-language-server",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::DotnetTool,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: Some("roslyn-language-server"),
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "fsharp",
        language_ids: &["fsharp"],
        extensions: &[".fs", ".fsi", ".fsx"],
        root_markers: &[".sln", ".fsproj"],
        program: "fsautocomplete",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::DotnetTool,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: Some("fsautocomplete"),
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "ruby",
        language_ids: &["ruby"],
        extensions: &[".rb", ".rake", ".gemspec"],
        root_markers: &["Gemfile"],
        program: "rubocop",
        args: RUBY_ARGS,
        env_program: None,
        acquire: AcquireKind::Gem,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: Some("rubocop"),
        primary: true,
    },
    ServerEntry {
        id: "deno",
        language_ids: &["typescript", "javascript"],
        extensions: &[".ts", ".tsx", ".js", ".jsx"],
        root_markers: &["deno.json", "deno.jsonc"],
        program: "deno",
        args: DENO_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "biome",
        language_ids: &["javascript", "typescript", "json"],
        extensions: &[".js", ".ts", ".jsx", ".tsx", ".json"],
        root_markers: &["biome.json", "biome.jsonc"],
        program: "biome",
        args: BIOME_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "prisma",
        language_ids: &["prisma"],
        extensions: &[".prisma"],
        root_markers: &["schema.prisma"],
        program: "prisma",
        args: PRISMA_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
    ServerEntry {
        id: "dart",
        language_ids: &["dart"],
        extensions: &[".dart"],
        root_markers: &["pubspec.yaml"],
        program: "dart",
        args: DART_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "jdtls",
        language_ids: &["java"],
        extensions: &[".java"],
        root_markers: &["pom.xml", "build.gradle", "build.gradle.kts"],
        program: "jdtls",
        args: EMPTY_ARGS,
        env_program: Some("LYRA_LSP_JDTLS"),
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "elixir",
        language_ids: &["elixir"],
        extensions: &[".ex", ".exs"],
        root_markers: &["mix.exs"],
        program: "elixir-ls",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "sourcekit",
        language_ids: &["swift"],
        extensions: &[".swift"],
        root_markers: &["Package.swift"],
        program: "sourcekit-lsp",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "gleam",
        language_ids: &["gleam"],
        extensions: &[".gleam"],
        root_markers: &["gleam.toml"],
        program: "gleam",
        args: GLEAM_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "clojure",
        language_ids: &["clojure"],
        extensions: &[".clj", ".cljs", ".cljc", ".edn"],
        root_markers: &["deps.edn", "project.clj"],
        program: "clojure-lsp",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "nixd",
        language_ids: &["nix"],
        extensions: &[".nix"],
        root_markers: &["flake.nix"],
        program: "nixd",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "hls",
        language_ids: &["haskell"],
        extensions: &[".hs", ".lhs"],
        root_markers: &["cabal.project", "stack.yaml", "package.yaml"],
        program: "haskell-language-server-wrapper",
        args: STDIO,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "julials",
        language_ids: &["julia"],
        extensions: &[".jl"],
        root_markers: &["Project.toml"],
        program: "julia",
        args: EMPTY_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: true,
    },
    ServerEntry {
        id: "ty",
        language_ids: &["python"],
        extensions: &[".py", ".pyi"],
        root_markers: &["ty.toml"],
        program: "ty",
        args: TY_ARGS,
        env_program: None,
        acquire: AcquireKind::Path,
        npm_package: None,
        npm_bin: None,
        pin_version: None,
        github_repo: None,
        go_package: None,
        dotnet_package: None,
        gem_package: None,
        primary: false,
    },
];

const EXCLUDED_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "vendor",
    "target",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    "archive",
    "references",
    "參考",
];

pub fn server_by_id(id: &str) -> Option<&'static ServerEntry> {
    SERVERS.iter().find(|entry| entry.id == id)
}

/// VS Code `extensions/yaml` ships grammars only — no language server.
/// yaml-language-server on a repo with `pnpm-lock.yaml` freezes the workbench.
pub fn spawns_language_server(entry: &ServerEntry) -> bool {
    entry.id != "yaml"
}

pub fn server_for_language(language_id: &str) -> Option<&'static ServerEntry> {
    server_for_language_in_project(language_id, None)
}

pub fn server_for_language_in_project(
    language_id: &str,
    project_root: Option<&std::path::Path>,
) -> Option<&'static ServerEntry> {
    let normalized = language_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    let mut candidates = SERVERS
        .iter()
        .filter(|entry| {
            entry
                .language_ids
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(&normalized))
        })
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return None;
    }
    if let Some(root) = project_root {
        candidates.sort_by_key(|entry| {
            let marker_hit = !entry.root_markers.is_empty()
                && entry
                    .root_markers
                    .iter()
                    .any(|marker| root.join(marker).exists());
            (!marker_hit, !entry.primary, entry.id)
        });
    }
    candidates.into_iter().next()
}

pub fn language_id_for_path(path: &str) -> Option<&'static str> {
    let file_name = std::path::Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path);
    if file_name.eq_ignore_ascii_case("Dockerfile") {
        return Some("dockerfile");
    }
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_ascii_lowercase()))?;
    SERVERS.iter().find_map(|entry| {
        entry
            .extensions
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&extension))
            .then_some(*entry.language_ids.first().unwrap_or(&entry.id))
    })
}

pub fn supported_language(language_id: &str) -> bool {
    server_for_language(language_id).is_some()
}

pub fn document_language_id(language_id: &str) -> String {
    server_for_language(language_id)
        .and_then(|entry| entry.language_ids.first().copied())
        .unwrap_or(language_id)
        .to_string()
}

pub fn detect_primary_servers(project_root: &std::path::Path) -> Vec<&'static ServerEntry> {
    let mut matched = Vec::new();
    collect_markers(project_root, project_root, 0, &mut matched);
    matched.sort_by_key(|entry| (!entry.primary, entry.id));
    matched.dedup_by_key(|entry| entry.id);
    matched
        .into_iter()
        .filter(|entry| entry.primary)
        .take(3)
        .collect()
}

fn collect_markers<'a>(
    root: &std::path::Path,
    dir: &std::path::Path,
    depth: usize,
    matched: &mut Vec<&'static ServerEntry>,
) {
    if depth > 1 {
        return;
    }
    for entry in SERVERS {
        if entry.root_markers.is_empty() {
            continue;
        }
        if entry
            .root_markers
            .iter()
            .any(|marker| dir.join(marker).exists())
        {
            matched.push(entry);
        }
    }
    if depth == 1 {
        return;
    }
    let Ok(children) = std::fs::read_dir(dir) else {
        return;
    };
    for child in children.flatten() {
        let path = child.path();
        if !path.is_dir() {
            continue;
        }
        let name = child.file_name();
        let name = name.to_string_lossy();
        if EXCLUDED_DIR_NAMES
            .iter()
            .any(|excluded| name.eq_ignore_ascii_case(excluded))
            || name.starts_with('.')
        {
            continue;
        }
        collect_markers(root, &path, depth + 1, matched);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("lyra-lsp-catalog-{name}-{stamp}"));
        fs::create_dir_all(&path).expect("temp dir");
        path
    }

    #[test]
    fn maps_extensions_to_language_ids() {
        assert_eq!(language_id_for_path("src/main.rs"), Some("rust"));
        assert_eq!(language_id_for_path("app/index.ts"), Some("typescript"));
        assert_eq!(language_id_for_path("pkg/mod.go"), Some("go"));
        assert_eq!(language_id_for_path("Dockerfile"), Some("dockerfile"));
        assert_eq!(language_id_for_path("notes.md"), None);
        assert_eq!(language_id_for_path("flake.nix"), Some("nix"));
        assert!(server_for_language("nix").is_some());
    }

    #[test]
    fn detects_primary_servers_from_root_markers() {
        let root = temp_dir("primary");
        fs::write(root.join("Cargo.toml"), "[package]\nname=\"demo\"\n").expect("cargo");
        fs::write(root.join("package.json"), "{}\n").expect("pkg");
        fs::write(root.join("go.mod"), "module demo\n").expect("go");
        let ids = detect_primary_servers(&root)
            .into_iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>();
        assert!(ids.contains(&"rust"));
        assert!(ids.contains(&"typescript"));
        assert!(ids.contains(&"gopls"));
        assert!(ids.len() <= 3);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ignores_vendor_trees_when_detecting_primaries() {
        let root = temp_dir("vendor");
        fs::create_dir_all(root.join("node_modules/leftpad")).expect("nm");
        fs::write(root.join("node_modules/leftpad/package.json"), "{}\n").expect("nested");
        let ids = detect_primary_servers(&root);
        assert!(ids.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn yaml_is_syntax_only_like_vscode() {
        let yaml = server_by_id("yaml").expect("yaml");
        assert!(!spawns_language_server(yaml));
        let typescript = server_by_id("typescript").expect("typescript");
        assert!(spawns_language_server(typescript));
    }
}
