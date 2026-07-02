// Copyright 2025-2026 Andrey Vasilevsky <anvanster@gmail.com>
// SPDX-License-Identifier: Apache-2.0

//! Parser Registry - Manages all language parsers implementing the CodeParser trait.

use codegraph::CodeGraph;
#[cfg(feature = "grammar-bash")]
use codegraph_bash::BashParser;
#[cfg(feature = "grammar-c")]
use codegraph_c::CParser;
#[cfg(feature = "grammar-clojure")]
use codegraph_clojure::ClojureParser;
#[cfg(feature = "grammar-cobol")]
use codegraph_cobol::CobolParser;
#[cfg(feature = "grammar-cpp")]
use codegraph_cpp::CppParser;
#[cfg(feature = "grammar-csharp")]
use codegraph_csharp::CSharpParser;
#[cfg(feature = "grammar-css")]
use codegraph_css::CssParser;
#[cfg(feature = "grammar-dart")]
use codegraph_dart::DartParser;
#[cfg(feature = "grammar-dockerfile")]
use codegraph_dockerfile::DockerfileParser;
#[cfg(feature = "grammar-elixir")]
use codegraph_elixir::ElixirParser;
#[cfg(feature = "grammar-elm")]
use codegraph_elm::ElmParser;
#[cfg(feature = "grammar-erlang")]
use codegraph_erlang::ErlangParser;
#[cfg(feature = "grammar-fortran")]
use codegraph_fortran::FortranParser;
#[cfg(feature = "grammar-go")]
use codegraph_go::GoParser;
#[cfg(feature = "grammar-groovy")]
use codegraph_groovy::GroovyParser;
#[cfg(feature = "grammar-haskell")]
use codegraph_haskell::HaskellParser;
#[cfg(feature = "grammar-hcl")]
use codegraph_hcl::HclParser;
#[cfg(feature = "grammar-java")]
use codegraph_java::JavaParser;
#[cfg(feature = "grammar-julia")]
use codegraph_julia::JuliaParser;
#[cfg(feature = "grammar-kotlin")]
use codegraph_kotlin::KotlinParser;
#[cfg(feature = "grammar-lua")]
use codegraph_lua::LuaParser;
#[cfg(feature = "grammar-objc")]
use codegraph_objc::ObjcParser;
#[cfg(feature = "grammar-ocaml")]
use codegraph_ocaml::OcamlParser;
use codegraph_parser_api::{CodeParser, FileInfo, ParserConfig, ParserError, ParserMetrics};
#[cfg(feature = "grammar-perl")]
use codegraph_perl::PerlParser;
#[cfg(feature = "grammar-php")]
use codegraph_php::PhpParser;
#[cfg(feature = "grammar-python")]
use codegraph_python::PythonParser;
#[cfg(feature = "grammar-r")]
use codegraph_r::RParser;
#[cfg(feature = "grammar-ruby")]
use codegraph_ruby::RubyParser;
#[cfg(feature = "grammar-rust")]
use codegraph_rust::RustParser;
#[cfg(feature = "grammar-scala")]
use codegraph_scala::ScalaParser;
#[cfg(feature = "grammar-solidity")]
use codegraph_solidity::SolidityParser;
#[cfg(feature = "grammar-swift")]
use codegraph_swift::SwiftParser;
#[cfg(feature = "grammar-tcl")]
use codegraph_tcl::TclParser;
#[cfg(feature = "grammar-toml")]
use codegraph_toml::TomlParser;
#[cfg(feature = "grammar-typescript")]
use codegraph_typescript::TypeScriptParser;
#[cfg(feature = "grammar-verilog")]
use codegraph_verilog::VerilogParser;
#[cfg(feature = "grammar-yaml")]
use codegraph_yaml::YamlParser;
#[cfg(feature = "grammar-zig")]
use codegraph_zig::ZigParser;
use std::path::Path;
use std::sync::{Arc, OnceLock};

#[allow(dead_code)]
struct ParserSlot<P: CodeParser + 'static> {
    config: ParserConfig,
    parser: OnceLock<Arc<P>>,
    build: fn(ParserConfig) -> P,
}

#[allow(dead_code)]
impl<P: CodeParser + 'static> ParserSlot<P> {
    fn new(config: ParserConfig, build: fn(ParserConfig) -> P) -> Self {
        Self {
            config,
            parser: OnceLock::new(),
            build,
        }
    }

    fn get(&self) -> Arc<P> {
        self.parser
            .get_or_init(|| Arc::new((self.build)(self.config.clone())))
            .clone()
    }

    fn get_dyn(&self) -> Arc<dyn CodeParser> {
        self.get()
    }

    fn metrics(&self) -> ParserMetrics {
        self.parser
            .get()
            .map(|parser| parser.metrics())
            .unwrap_or_default()
    }
}

fn language_enabled(language: &str) -> bool {
    match language {
        "bash" => cfg!(feature = "grammar-bash"),
        "c" => cfg!(feature = "grammar-c"),
        "clojure" => cfg!(feature = "grammar-clojure"),
        "cobol" => cfg!(feature = "grammar-cobol"),
        "cpp" => cfg!(feature = "grammar-cpp"),
        "css" => cfg!(feature = "grammar-css"),
        "csharp" => cfg!(feature = "grammar-csharp"),
        "dart" => cfg!(feature = "grammar-dart"),
        "dockerfile" => cfg!(feature = "grammar-dockerfile"),
        "elixir" => cfg!(feature = "grammar-elixir"),
        "elm" => cfg!(feature = "grammar-elm"),
        "erlang" => cfg!(feature = "grammar-erlang"),
        "fortran" => cfg!(feature = "grammar-fortran"),
        "go" => cfg!(feature = "grammar-go"),
        "groovy" => cfg!(feature = "grammar-groovy"),
        "haskell" => cfg!(feature = "grammar-haskell"),
        "hcl" => cfg!(feature = "grammar-hcl"),
        "java" => cfg!(feature = "grammar-java"),
        "julia" => cfg!(feature = "grammar-julia"),
        "kotlin" => cfg!(feature = "grammar-kotlin"),
        "lua" => cfg!(feature = "grammar-lua"),
        "objc" => cfg!(feature = "grammar-objc"),
        "ocaml" => cfg!(feature = "grammar-ocaml"),
        "perl" => cfg!(feature = "grammar-perl"),
        "php" => cfg!(feature = "grammar-php"),
        "python" => cfg!(feature = "grammar-python"),
        "r" => cfg!(feature = "grammar-r"),
        "ruby" => cfg!(feature = "grammar-ruby"),
        "rust" => cfg!(feature = "grammar-rust"),
        "scala" => cfg!(feature = "grammar-scala"),
        "solidity" => cfg!(feature = "grammar-solidity"),
        "swift" => cfg!(feature = "grammar-swift"),
        "tcl" => cfg!(feature = "grammar-tcl"),
        "toml" => cfg!(feature = "grammar-toml"),
        "typescript" | "javascript" => cfg!(feature = "grammar-typescript"),
        "verilog" => cfg!(feature = "grammar-verilog"),
        "yaml" => cfg!(feature = "grammar-yaml"),
        "zig" => cfg!(feature = "grammar-zig"),
        _ => false,
    }
}

fn enabled_language(language: &'static str) -> Option<&'static str> {
    language_enabled(language).then_some(language)
}

/// Registry of all available language parsers.
pub struct ParserRegistry {
    #[cfg(feature = "grammar-bash")]
    bash: ParserSlot<BashParser>,
    #[cfg(feature = "grammar-c")]
    c: ParserSlot<CParser>,
    #[cfg(feature = "grammar-clojure")]
    clojure: ParserSlot<ClojureParser>,
    #[cfg(feature = "grammar-cobol")]
    cobol: ParserSlot<CobolParser>,
    #[cfg(feature = "grammar-cpp")]
    cpp: ParserSlot<CppParser>,
    #[cfg(feature = "grammar-css")]
    css: ParserSlot<CssParser>,
    #[cfg(feature = "grammar-csharp")]
    csharp: ParserSlot<CSharpParser>,
    #[cfg(feature = "grammar-dart")]
    dart: ParserSlot<DartParser>,
    #[cfg(feature = "grammar-dockerfile")]
    dockerfile: ParserSlot<DockerfileParser>,
    #[cfg(feature = "grammar-elixir")]
    elixir: ParserSlot<ElixirParser>,
    #[cfg(feature = "grammar-elm")]
    elm: ParserSlot<ElmParser>,
    #[cfg(feature = "grammar-erlang")]
    erlang: ParserSlot<ErlangParser>,
    #[cfg(feature = "grammar-fortran")]
    fortran: ParserSlot<FortranParser>,
    #[cfg(feature = "grammar-go")]
    go: ParserSlot<GoParser>,
    #[cfg(feature = "grammar-groovy")]
    groovy: ParserSlot<GroovyParser>,
    #[cfg(feature = "grammar-haskell")]
    haskell: ParserSlot<HaskellParser>,
    #[cfg(feature = "grammar-hcl")]
    hcl: ParserSlot<HclParser>,
    #[cfg(feature = "grammar-java")]
    java: ParserSlot<JavaParser>,
    #[cfg(feature = "grammar-julia")]
    julia: ParserSlot<JuliaParser>,
    #[cfg(feature = "grammar-kotlin")]
    kotlin: ParserSlot<KotlinParser>,
    #[cfg(feature = "grammar-lua")]
    lua: ParserSlot<LuaParser>,
    #[cfg(feature = "grammar-objc")]
    objc: ParserSlot<ObjcParser>,
    #[cfg(feature = "grammar-ocaml")]
    ocaml: ParserSlot<OcamlParser>,
    #[cfg(feature = "grammar-perl")]
    perl: ParserSlot<PerlParser>,
    #[cfg(feature = "grammar-php")]
    php: ParserSlot<PhpParser>,
    #[cfg(feature = "grammar-python")]
    python: ParserSlot<PythonParser>,
    #[cfg(feature = "grammar-r")]
    r: ParserSlot<RParser>,
    #[cfg(feature = "grammar-ruby")]
    ruby: ParserSlot<RubyParser>,
    #[cfg(feature = "grammar-rust")]
    rust: ParserSlot<RustParser>,
    #[cfg(feature = "grammar-scala")]
    scala: ParserSlot<ScalaParser>,
    #[cfg(feature = "grammar-solidity")]
    solidity: ParserSlot<SolidityParser>,
    #[cfg(feature = "grammar-swift")]
    swift: ParserSlot<SwiftParser>,
    #[cfg(feature = "grammar-tcl")]
    tcl: ParserSlot<TclParser>,
    #[cfg(feature = "grammar-toml")]
    toml: ParserSlot<TomlParser>,
    #[cfg(feature = "grammar-typescript")]
    typescript: ParserSlot<TypeScriptParser>,
    #[cfg(feature = "grammar-verilog")]
    verilog: ParserSlot<VerilogParser>,
    #[cfg(feature = "grammar-yaml")]
    yaml: ParserSlot<YamlParser>,
    #[cfg(feature = "grammar-zig")]
    zig: ParserSlot<ZigParser>,
}

impl ParserRegistry {
    /// Create a new parser registry with default configuration.
    pub fn new() -> Self {
        Self::with_config(ParserConfig::default())
    }

    /// Create a new parser registry with custom configuration.
    #[allow(unused_variables)]
    pub fn with_config(config: ParserConfig) -> Self {
        Self {
            #[cfg(feature = "grammar-bash")]
            bash: ParserSlot::new(config.clone(), BashParser::with_config),
            #[cfg(feature = "grammar-c")]
            c: ParserSlot::new(config.clone(), CParser::with_config),
            #[cfg(feature = "grammar-clojure")]
            clojure: ParserSlot::new(config.clone(), ClojureParser::with_config),
            #[cfg(feature = "grammar-cobol")]
            cobol: ParserSlot::new(config.clone(), CobolParser::with_config),
            #[cfg(feature = "grammar-cpp")]
            cpp: ParserSlot::new(config.clone(), CppParser::with_config),
            #[cfg(feature = "grammar-css")]
            css: ParserSlot::new(config.clone(), CssParser::with_config),
            #[cfg(feature = "grammar-csharp")]
            csharp: ParserSlot::new(config.clone(), CSharpParser::with_config),
            #[cfg(feature = "grammar-dart")]
            dart: ParserSlot::new(config.clone(), DartParser::with_config),
            #[cfg(feature = "grammar-dockerfile")]
            dockerfile: ParserSlot::new(config.clone(), DockerfileParser::with_config),
            #[cfg(feature = "grammar-elixir")]
            elixir: ParserSlot::new(config.clone(), ElixirParser::with_config),
            #[cfg(feature = "grammar-elm")]
            elm: ParserSlot::new(config.clone(), ElmParser::with_config),
            #[cfg(feature = "grammar-erlang")]
            erlang: ParserSlot::new(config.clone(), ErlangParser::with_config),
            #[cfg(feature = "grammar-fortran")]
            fortran: ParserSlot::new(config.clone(), FortranParser::with_config),
            #[cfg(feature = "grammar-go")]
            go: ParserSlot::new(config.clone(), GoParser::with_config),
            #[cfg(feature = "grammar-groovy")]
            groovy: ParserSlot::new(config.clone(), GroovyParser::with_config),
            #[cfg(feature = "grammar-haskell")]
            haskell: ParserSlot::new(config.clone(), HaskellParser::with_config),
            #[cfg(feature = "grammar-hcl")]
            hcl: ParserSlot::new(config.clone(), HclParser::with_config),
            #[cfg(feature = "grammar-java")]
            java: ParserSlot::new(config.clone(), JavaParser::with_config),
            #[cfg(feature = "grammar-julia")]
            julia: ParserSlot::new(config.clone(), JuliaParser::with_config),
            #[cfg(feature = "grammar-kotlin")]
            kotlin: ParserSlot::new(config.clone(), KotlinParser::with_config),
            #[cfg(feature = "grammar-lua")]
            lua: ParserSlot::new(config.clone(), LuaParser::with_config),
            #[cfg(feature = "grammar-objc")]
            objc: ParserSlot::new(config.clone(), ObjcParser::with_config),
            #[cfg(feature = "grammar-ocaml")]
            ocaml: ParserSlot::new(config.clone(), OcamlParser::with_config),
            #[cfg(feature = "grammar-perl")]
            perl: ParserSlot::new(config.clone(), PerlParser::with_config),
            #[cfg(feature = "grammar-php")]
            php: ParserSlot::new(config.clone(), PhpParser::with_config),
            #[cfg(feature = "grammar-python")]
            python: ParserSlot::new(config.clone(), PythonParser::with_config),
            #[cfg(feature = "grammar-r")]
            r: ParserSlot::new(config.clone(), RParser::with_config),
            #[cfg(feature = "grammar-ruby")]
            ruby: ParserSlot::new(config.clone(), RubyParser::with_config),
            #[cfg(feature = "grammar-rust")]
            rust: ParserSlot::new(config.clone(), RustParser::with_config),
            #[cfg(feature = "grammar-scala")]
            scala: ParserSlot::new(config.clone(), ScalaParser::with_config),
            #[cfg(feature = "grammar-solidity")]
            solidity: ParserSlot::new(config.clone(), SolidityParser::with_config),
            #[cfg(feature = "grammar-swift")]
            swift: ParserSlot::new(config.clone(), SwiftParser::with_config),
            #[cfg(feature = "grammar-tcl")]
            tcl: ParserSlot::new(config.clone(), TclParser::with_config),
            #[cfg(feature = "grammar-toml")]
            toml: ParserSlot::new(config.clone(), TomlParser::with_config),
            #[cfg(feature = "grammar-typescript")]
            typescript: ParserSlot::new(config.clone(), TypeScriptParser::with_config),
            #[cfg(feature = "grammar-verilog")]
            verilog: ParserSlot::new(config.clone(), VerilogParser::with_config),
            #[cfg(feature = "grammar-yaml")]
            yaml: ParserSlot::new(config.clone(), YamlParser::with_config),
            #[cfg(feature = "grammar-zig")]
            zig: ParserSlot::new(config, ZigParser::with_config),
        }
    }

    #[cfg(test)]
    fn initialized_parser_count(&self) -> usize {
        let mut count = 0;
        #[cfg(feature = "grammar-bash")]
        if self.bash.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-c")]
        if self.c.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-clojure")]
        if self.clojure.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-cobol")]
        if self.cobol.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-cpp")]
        if self.cpp.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-css")]
        if self.css.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-csharp")]
        if self.csharp.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-dart")]
        if self.dart.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-dockerfile")]
        if self.dockerfile.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-elixir")]
        if self.elixir.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-elm")]
        if self.elm.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-erlang")]
        if self.erlang.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-fortran")]
        if self.fortran.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-go")]
        if self.go.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-groovy")]
        if self.groovy.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-haskell")]
        if self.haskell.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-hcl")]
        if self.hcl.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-java")]
        if self.java.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-julia")]
        if self.julia.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-kotlin")]
        if self.kotlin.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-lua")]
        if self.lua.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-objc")]
        if self.objc.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-ocaml")]
        if self.ocaml.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-perl")]
        if self.perl.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-php")]
        if self.php.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-python")]
        if self.python.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-r")]
        if self.r.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-ruby")]
        if self.ruby.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-rust")]
        if self.rust.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-scala")]
        if self.scala.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-solidity")]
        if self.solidity.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-swift")]
        if self.swift.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-tcl")]
        if self.tcl.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-toml")]
        if self.toml.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-typescript")]
        if self.typescript.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-verilog")]
        if self.verilog.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-yaml")]
        if self.yaml.parser.get().is_some() {
            count += 1;
        }
        #[cfg(feature = "grammar-zig")]
        if self.zig.parser.get().is_some() {
            count += 1;
        }
        count
    }

    /// Get parser by language identifier.
    pub fn get_parser(&self, language: &str) -> Option<Arc<dyn CodeParser>> {
        match language.to_lowercase().as_str() {
            #[cfg(feature = "grammar-bash")]
            "bash" | "shell" | "sh" => Some(self.bash.get_dyn()),
            #[cfg(feature = "grammar-c")]
            "c" => Some(self.c.get_dyn()),
            #[cfg(feature = "grammar-clojure")]
            "clojure" => Some(self.clojure.get_dyn()),
            #[cfg(feature = "grammar-cobol")]
            "cobol" => Some(self.cobol.get_dyn()),
            #[cfg(feature = "grammar-cpp")]
            "cpp" | "c++" => Some(self.cpp.get_dyn()),
            #[cfg(feature = "grammar-css")]
            "css" => Some(self.css.get_dyn()),
            #[cfg(feature = "grammar-csharp")]
            "csharp" | "c#" => Some(self.csharp.get_dyn()),
            #[cfg(feature = "grammar-dart")]
            "dart" => Some(self.dart.get_dyn()),
            #[cfg(feature = "grammar-dockerfile")]
            "dockerfile" | "containerfile" => Some(self.dockerfile.get_dyn()),
            #[cfg(feature = "grammar-elixir")]
            "elixir" => Some(self.elixir.get_dyn()),
            #[cfg(feature = "grammar-elm")]
            "elm" => Some(self.elm.get_dyn()),
            #[cfg(feature = "grammar-erlang")]
            "erlang" => Some(self.erlang.get_dyn()),
            #[cfg(feature = "grammar-fortran")]
            "fortran" => Some(self.fortran.get_dyn()),
            #[cfg(feature = "grammar-go")]
            "go" => Some(self.go.get_dyn()),
            #[cfg(feature = "grammar-groovy")]
            "groovy" => Some(self.groovy.get_dyn()),
            #[cfg(feature = "grammar-haskell")]
            "haskell" => Some(self.haskell.get_dyn()),
            #[cfg(feature = "grammar-hcl")]
            "hcl" | "terraform" => Some(self.hcl.get_dyn()),
            #[cfg(feature = "grammar-java")]
            "java" => Some(self.java.get_dyn()),
            #[cfg(feature = "grammar-julia")]
            "julia" => Some(self.julia.get_dyn()),
            #[cfg(feature = "grammar-kotlin")]
            "kotlin" => Some(self.kotlin.get_dyn()),
            #[cfg(feature = "grammar-lua")]
            "lua" => Some(self.lua.get_dyn()),
            #[cfg(feature = "grammar-objc")]
            "objc" | "objective-c" | "objectivec" => Some(self.objc.get_dyn()),
            #[cfg(feature = "grammar-ocaml")]
            "ocaml" => Some(self.ocaml.get_dyn()),
            #[cfg(feature = "grammar-perl")]
            "perl" => Some(self.perl.get_dyn()),
            #[cfg(feature = "grammar-php")]
            "php" => Some(self.php.get_dyn()),
            #[cfg(feature = "grammar-python")]
            "python" => Some(self.python.get_dyn()),
            #[cfg(feature = "grammar-r")]
            "r" => Some(self.r.get_dyn()),
            #[cfg(feature = "grammar-ruby")]
            "ruby" => Some(self.ruby.get_dyn()),
            #[cfg(feature = "grammar-rust")]
            "rust" => Some(self.rust.get_dyn()),
            #[cfg(feature = "grammar-scala")]
            "scala" => Some(self.scala.get_dyn()),
            #[cfg(feature = "grammar-solidity")]
            "solidity" | "sol" => Some(self.solidity.get_dyn()),
            #[cfg(feature = "grammar-swift")]
            "swift" => Some(self.swift.get_dyn()),
            #[cfg(feature = "grammar-tcl")]
            "tcl" => Some(self.tcl.get_dyn()),
            #[cfg(feature = "grammar-toml")]
            "toml" => Some(self.toml.get_dyn()),
            #[cfg(feature = "grammar-typescript")]
            "typescript" | "javascript" | "typescriptreact" | "javascriptreact" => {
                Some(self.typescript.get_dyn())
            }
            #[cfg(feature = "grammar-verilog")]
            "verilog" | "systemverilog" => Some(self.verilog.get_dyn()),
            #[cfg(feature = "grammar-yaml")]
            "yaml" => Some(self.yaml.get_dyn()),
            #[cfg(feature = "grammar-zig")]
            "zig" => Some(self.zig.get_dyn()),
            _ => None,
        }
    }

    /// Find appropriate parser for a file path.
    ///
    /// Note: C is checked before C++ so `.h` files default to C parsing.
    /// C++-specific extensions (`.hpp`, `.cc`, `.cxx`, `.hh`, `.hxx`) are
    /// only claimed by the C++ parser and resolve correctly.
    pub fn parser_for_path(&self, path: &Path) -> Option<Arc<dyn CodeParser>> {
        self.language_for_path(path)
            .and_then(|language| self.get_parser(language))
    }

    /// Get all supported file extensions.
    #[allow(unused_mut)]
    pub fn supported_extensions(&self) -> Vec<&str> {
        let mut extensions = Vec::new();
        #[cfg(feature = "grammar-bash")]
        extensions.extend([".sh", ".bash", ".zsh"]);
        #[cfg(feature = "grammar-c")]
        extensions.extend([".c", ".h"]);
        #[cfg(feature = "grammar-clojure")]
        extensions.extend([".clj", ".cljs", ".cljc", ".edn"]);
        #[cfg(feature = "grammar-cobol")]
        extensions.extend([".cob", ".cbl", ".cobol", ".cpy"]);
        #[cfg(feature = "grammar-cpp")]
        extensions.extend([".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"]);
        #[cfg(feature = "grammar-css")]
        extensions.extend([".css"]);
        #[cfg(feature = "grammar-csharp")]
        extensions.extend([".cs"]);
        #[cfg(feature = "grammar-dart")]
        extensions.extend([".dart"]);
        #[cfg(feature = "grammar-dockerfile")]
        extensions.extend([".dockerfile"]);
        #[cfg(feature = "grammar-elixir")]
        extensions.extend([".ex", ".exs"]);
        #[cfg(feature = "grammar-elm")]
        extensions.extend([".elm"]);
        #[cfg(feature = "grammar-erlang")]
        extensions.extend([".erl", ".hrl"]);
        #[cfg(feature = "grammar-fortran")]
        extensions.extend([
            ".f", ".f90", ".f95", ".f03", ".f08", ".for", ".ftn", ".F", ".F90",
        ]);
        #[cfg(feature = "grammar-go")]
        extensions.extend([".go"]);
        #[cfg(feature = "grammar-groovy")]
        extensions.extend([".groovy", ".gradle"]);
        #[cfg(feature = "grammar-haskell")]
        extensions.extend([".hs"]);
        #[cfg(feature = "grammar-hcl")]
        extensions.extend([".tf", ".hcl", ".tfvars"]);
        #[cfg(feature = "grammar-java")]
        extensions.extend([".java"]);
        #[cfg(feature = "grammar-julia")]
        extensions.extend([".jl"]);
        #[cfg(feature = "grammar-kotlin")]
        extensions.extend([".kt", ".kts"]);
        #[cfg(feature = "grammar-lua")]
        extensions.extend([".lua"]);
        #[cfg(feature = "grammar-objc")]
        extensions.extend([".m", ".mm"]);
        #[cfg(feature = "grammar-ocaml")]
        extensions.extend([".ml", ".mli"]);
        #[cfg(feature = "grammar-perl")]
        extensions.extend([".pl", ".pm", ".t"]);
        #[cfg(feature = "grammar-php")]
        extensions.extend([".php"]);
        #[cfg(feature = "grammar-python")]
        extensions.extend([".py", ".pyw"]);
        #[cfg(feature = "grammar-r")]
        extensions.extend([".r", ".R", ".Rmd"]);
        #[cfg(feature = "grammar-ruby")]
        extensions.extend([".rb", ".rake", ".gemspec"]);
        #[cfg(feature = "grammar-rust")]
        extensions.extend([".rs"]);
        #[cfg(feature = "grammar-scala")]
        extensions.extend([".scala", ".sc"]);
        #[cfg(feature = "grammar-solidity")]
        extensions.extend([".sol"]);
        #[cfg(feature = "grammar-swift")]
        extensions.extend([".swift"]);
        #[cfg(feature = "grammar-tcl")]
        extensions.extend([".tcl", ".sdc", ".upf"]);
        #[cfg(feature = "grammar-toml")]
        extensions.extend([".toml"]);
        #[cfg(feature = "grammar-typescript")]
        extensions.extend([".ts", ".tsx", ".js", ".jsx"]);
        #[cfg(feature = "grammar-verilog")]
        extensions.extend([".sv", ".svh", ".v", ".vh"]);
        #[cfg(feature = "grammar-yaml")]
        extensions.extend([".yml", ".yaml"]);
        #[cfg(feature = "grammar-zig")]
        extensions.extend([".zig"]);
        extensions
    }

    /// Get metrics from all parsers.
    #[allow(unused_mut)]
    pub fn all_metrics(&self) -> Vec<(&str, ParserMetrics)> {
        let mut metrics = Vec::new();
        #[cfg(feature = "grammar-bash")]
        metrics.push(("bash", self.bash.metrics()));
        #[cfg(feature = "grammar-c")]
        metrics.push(("c", self.c.metrics()));
        #[cfg(feature = "grammar-clojure")]
        metrics.push(("clojure", self.clojure.metrics()));
        #[cfg(feature = "grammar-cobol")]
        metrics.push(("cobol", self.cobol.metrics()));
        #[cfg(feature = "grammar-cpp")]
        metrics.push(("cpp", self.cpp.metrics()));
        #[cfg(feature = "grammar-css")]
        metrics.push(("css", self.css.metrics()));
        #[cfg(feature = "grammar-csharp")]
        metrics.push(("csharp", self.csharp.metrics()));
        #[cfg(feature = "grammar-dart")]
        metrics.push(("dart", self.dart.metrics()));
        #[cfg(feature = "grammar-dockerfile")]
        metrics.push(("dockerfile", self.dockerfile.metrics()));
        #[cfg(feature = "grammar-elixir")]
        metrics.push(("elixir", self.elixir.metrics()));
        #[cfg(feature = "grammar-elm")]
        metrics.push(("elm", self.elm.metrics()));
        #[cfg(feature = "grammar-erlang")]
        metrics.push(("erlang", self.erlang.metrics()));
        #[cfg(feature = "grammar-fortran")]
        metrics.push(("fortran", self.fortran.metrics()));
        #[cfg(feature = "grammar-go")]
        metrics.push(("go", self.go.metrics()));
        #[cfg(feature = "grammar-groovy")]
        metrics.push(("groovy", self.groovy.metrics()));
        #[cfg(feature = "grammar-haskell")]
        metrics.push(("haskell", self.haskell.metrics()));
        #[cfg(feature = "grammar-hcl")]
        metrics.push(("hcl", self.hcl.metrics()));
        #[cfg(feature = "grammar-java")]
        metrics.push(("java", self.java.metrics()));
        #[cfg(feature = "grammar-julia")]
        metrics.push(("julia", self.julia.metrics()));
        #[cfg(feature = "grammar-kotlin")]
        metrics.push(("kotlin", self.kotlin.metrics()));
        #[cfg(feature = "grammar-lua")]
        metrics.push(("lua", self.lua.metrics()));
        #[cfg(feature = "grammar-objc")]
        metrics.push(("objc", self.objc.metrics()));
        #[cfg(feature = "grammar-ocaml")]
        metrics.push(("ocaml", self.ocaml.metrics()));
        #[cfg(feature = "grammar-perl")]
        metrics.push(("perl", self.perl.metrics()));
        #[cfg(feature = "grammar-php")]
        metrics.push(("php", self.php.metrics()));
        #[cfg(feature = "grammar-python")]
        metrics.push(("python", self.python.metrics()));
        #[cfg(feature = "grammar-r")]
        metrics.push(("r", self.r.metrics()));
        #[cfg(feature = "grammar-ruby")]
        metrics.push(("ruby", self.ruby.metrics()));
        #[cfg(feature = "grammar-rust")]
        metrics.push(("rust", self.rust.metrics()));
        #[cfg(feature = "grammar-scala")]
        metrics.push(("scala", self.scala.metrics()));
        #[cfg(feature = "grammar-solidity")]
        metrics.push(("solidity", self.solidity.metrics()));
        #[cfg(feature = "grammar-swift")]
        metrics.push(("swift", self.swift.metrics()));
        #[cfg(feature = "grammar-tcl")]
        metrics.push(("tcl", self.tcl.metrics()));
        #[cfg(feature = "grammar-toml")]
        metrics.push(("toml", self.toml.metrics()));
        #[cfg(feature = "grammar-typescript")]
        metrics.push(("typescript", self.typescript.metrics()));
        #[cfg(feature = "grammar-verilog")]
        metrics.push(("verilog", self.verilog.metrics()));
        #[cfg(feature = "grammar-yaml")]
        metrics.push(("yaml", self.yaml.metrics()));
        #[cfg(feature = "grammar-zig")]
        metrics.push(("zig", self.zig.metrics()));
        metrics
    }

    /// Check if a file path is supported by any parser.
    pub fn can_parse(&self, path: &Path) -> bool {
        self.language_for_path(path).is_some()
    }

    /// Parse a file using the appropriate parser.
    pub fn parse_file(&self, path: &Path, graph: &mut CodeGraph) -> Result<FileInfo, ParserError> {
        let parser = self.parser_for_path(path).ok_or_else(|| {
            ParserError::UnsupportedFeature(path.to_path_buf(), "Unsupported file type".to_string())
        })?;

        parser.parse_file(path, graph)
    }

    /// Parse source code string using the appropriate parser for the given path.
    pub fn parse_source(
        &self,
        source: &str,
        path: &Path,
        graph: &mut CodeGraph,
    ) -> Result<FileInfo, ParserError> {
        let parser = self.parser_for_path(path).ok_or_else(|| {
            ParserError::UnsupportedFeature(path.to_path_buf(), "Unsupported file type".to_string())
        })?;

        parser.parse_source(source, path, graph)
    }

    /// Get language name for a file path.
    ///
    /// Note: `.h` files return `"c"` by convention (C-compatible headers).
    /// Use `.hpp`/`.hh`/`.hxx` for C++ headers.
    pub fn language_for_path(&self, path: &Path) -> Option<&'static str> {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if matches!(file_name, "Dockerfile" | "Containerfile")
            || file_name.ends_with(".Dockerfile")
            || file_name.ends_with(".dockerfile")
        {
            return enabled_language("dockerfile");
        }

        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())?;

        match ext.as_str() {
            "sh" | "bash" | "zsh" => enabled_language("bash"),
            "c" => enabled_language("c"),
            "h" => enabled_language("c").or_else(|| enabled_language("cpp")),
            "clj" | "cljs" | "cljc" | "edn" => enabled_language("clojure"),
            "cob" | "cbl" | "cobol" | "cpy" => enabled_language("cobol"),
            "cpp" | "cc" | "cxx" | "hpp" | "hh" | "hxx" => enabled_language("cpp"),
            "css" => enabled_language("css"),
            "cs" => enabled_language("csharp"),
            "dart" => enabled_language("dart"),
            "dockerfile" => enabled_language("dockerfile"),
            "ex" | "exs" => enabled_language("elixir"),
            "elm" => enabled_language("elm"),
            "erl" | "hrl" => enabled_language("erlang"),
            "f" | "f90" | "f95" | "f03" | "f08" | "for" | "ftn" => enabled_language("fortran"),
            "go" => enabled_language("go"),
            "groovy" | "gradle" => enabled_language("groovy"),
            "hs" => enabled_language("haskell"),
            "tf" | "hcl" | "tfvars" => enabled_language("hcl"),
            "java" => enabled_language("java"),
            "jl" => enabled_language("julia"),
            "kt" | "kts" => enabled_language("kotlin"),
            "lua" => enabled_language("lua"),
            "m" | "mm" => enabled_language("objc"),
            "ml" | "mli" => enabled_language("ocaml"),
            "pl" | "pm" => enabled_language("perl"),
            "php" => enabled_language("php"),
            "py" | "pyw" => enabled_language("python"),
            "r" | "rmd" => enabled_language("r"),
            "rb" | "rake" | "gemspec" => enabled_language("ruby"),
            "rs" => enabled_language("rust"),
            "scala" | "sc" => enabled_language("scala"),
            "sol" => enabled_language("solidity"),
            "swift" => enabled_language("swift"),
            "tcl" | "sdc" | "upf" => enabled_language("tcl"),
            "toml" => enabled_language("toml"),
            "ts" | "tsx" => enabled_language("typescript"),
            "js" | "jsx" => enabled_language("javascript"),
            "sv" | "svh" | "v" | "vh" => enabled_language("verilog"),
            "yml" | "yaml" => enabled_language("yaml"),
            "zig" => enabled_language("zig"),
            _ => None,
        }
    }
}

impl Default for ParserRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use tempfile::NamedTempFile;

    #[test]
    fn test_parser_registry_new() {
        let registry = ParserRegistry::new();
        assert!(registry.get_parser("c").is_some());
        assert!(registry.get_parser("cobol").is_some());
        assert!(registry.get_parser("cpp").is_some());
        assert!(registry.get_parser("csharp").is_some());
        assert!(registry.get_parser("dart").is_some());
        assert!(registry.get_parser("fortran").is_some());
        assert!(registry.get_parser("go").is_some());
        assert!(registry.get_parser("java").is_some());
        assert!(registry.get_parser("kotlin").is_some());
        assert!(registry.get_parser("lua").is_some());
        assert!(registry.get_parser("groovy").is_some());
        assert!(registry.get_parser("php").is_some());
        assert!(registry.get_parser("python").is_some());
        assert!(registry.get_parser("r").is_some());
        assert!(registry.get_parser("ruby").is_some());
        assert!(registry.get_parser("rust").is_some());
        assert!(registry.get_parser("scala").is_some());
        assert!(registry.get_parser("swift").is_some());
        assert!(registry.get_parser("tcl").is_some());
        assert!(registry.get_parser("typescript").is_some());
        assert!(registry.get_parser("verilog").is_some());
        assert!(registry.get_parser("zig").is_some());
    }

    #[cfg(feature = "grammar-rust")]
    #[test]
    fn test_parser_registry_lazy_until_parser_requested() {
        let registry = ParserRegistry::new();
        assert_eq!(registry.initialized_parser_count(), 0);
        assert!(registry.can_parse(Path::new("src/lib.rs")));
        assert_eq!(
            registry.language_for_path(Path::new("src/lib.rs")),
            Some("rust")
        );
        assert_eq!(registry.initialized_parser_count(), 0);
        assert!(registry.get_parser("rust").is_some());
        assert_eq!(registry.initialized_parser_count(), 1);
    }

    #[test]
    fn test_parser_registry_default() {
        let registry = ParserRegistry::default();
        assert!(registry.get_parser("python").is_some());
    }

    #[test]
    fn test_parser_registry_with_config() {
        let config = ParserConfig::default();
        let registry = ParserRegistry::with_config(config);
        assert!(registry.get_parser("python").is_some());
    }

    #[test]
    fn test_get_parser_case_insensitive() {
        let registry = ParserRegistry::new();
        assert!(registry.get_parser("C").is_some());
        assert!(registry.get_parser("C++").is_some());
        assert!(registry.get_parser("C#").is_some());
        assert!(registry.get_parser("COBOL").is_some());
        assert!(registry.get_parser("Cpp").is_some());
        assert!(registry.get_parser("CSharp").is_some());
        assert!(registry.get_parser("FORTRAN").is_some());
        assert!(registry.get_parser("Go").is_some());
        assert!(registry.get_parser("JAVA").is_some());
        assert!(registry.get_parser("Java").is_some());
        assert!(registry.get_parser("Kotlin").is_some());
        assert!(registry.get_parser("PHP").is_some());
        assert!(registry.get_parser("PYTHON").is_some());
        assert!(registry.get_parser("Python").is_some());
        assert!(registry.get_parser("RUST").is_some());
        assert!(registry.get_parser("Rust").is_some());
        assert!(registry.get_parser("Ruby").is_some());
        assert!(registry.get_parser("Swift").is_some());
        assert!(registry.get_parser("TCL").is_some());
        assert!(registry.get_parser("TypeScript").is_some());
        assert!(registry.get_parser("Dart").is_some());
        assert!(registry.get_parser("Lua").is_some());
        assert!(registry.get_parser("Groovy").is_some());
        assert!(registry.get_parser("Scala").is_some());
        assert!(registry.get_parser("Zig").is_some());
    }

    #[test]
    fn test_get_parser_javascript_variants() {
        let registry = ParserRegistry::new();
        assert!(registry.get_parser("javascript").is_some());
        assert!(registry.get_parser("typescriptreact").is_some());
        assert!(registry.get_parser("javascriptreact").is_some());
    }

    #[test]
    fn test_get_parser_unknown_language() {
        let registry = ParserRegistry::new();
        assert!(registry.get_parser("unknown").is_none());
        assert!(registry.get_parser("").is_none());
    }

    #[test]
    fn test_parser_for_path() {
        let registry = ParserRegistry::new();
        assert!(registry.parser_for_path(&PathBuf::from("test.c")).is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.cob"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.cpp"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.cs"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.f90"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.go"))
            .is_some());
        assert!(registry.parser_for_path(&PathBuf::from("test.h")).is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("Test.java"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.js"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.kt"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.php"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.py"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.rb"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.rs"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.swift"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.tcl"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.ts"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.sv"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.dart"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.zig"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.lua"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("Service.groovy"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("build.gradle"))
            .is_some());
        assert!(registry.parser_for_path(&PathBuf::from("test.R")).is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.scala"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.txt"))
            .is_none());
    }

    #[test]
    fn test_parser_for_path_cpp_variants() {
        let registry = ParserRegistry::new();
        assert!(registry
            .parser_for_path(&PathBuf::from("test.cc"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.cxx"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.hpp"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.hh"))
            .is_some());
        assert!(registry
            .parser_for_path(&PathBuf::from("test.hxx"))
            .is_some());
    }

    #[test]
    fn test_supported_extensions() {
        let registry = ParserRegistry::new();
        let extensions = registry.supported_extensions();
        assert!(!extensions.is_empty());
        assert!(extensions.len() >= 22);
    }

    #[test]
    fn test_can_parse() {
        let registry = ParserRegistry::new();
        assert!(registry.can_parse(Path::new("test.c")));
        assert!(registry.can_parse(Path::new("test.cob")));
        assert!(registry.can_parse(Path::new("test.cpp")));
        assert!(registry.can_parse(Path::new("test.cs")));
        assert!(registry.can_parse(Path::new("test.f90")));
        assert!(registry.can_parse(Path::new("test.go")));
        assert!(registry.can_parse(Path::new("test.h")));
        assert!(registry.can_parse(Path::new("test.java")));
        assert!(registry.can_parse(Path::new("test.js")));
        assert!(registry.can_parse(Path::new("test.kt")));
        assert!(registry.can_parse(Path::new("test.php")));
        assert!(registry.can_parse(Path::new("test.py")));
        assert!(registry.can_parse(Path::new("test.rb")));
        assert!(registry.can_parse(Path::new("test.rs")));
        assert!(registry.can_parse(Path::new("test.sv")));
        assert!(registry.can_parse(Path::new("test.swift")));
        assert!(registry.can_parse(Path::new("test.tcl")));
        assert!(registry.can_parse(Path::new("test.ts")));
        assert!(registry.can_parse(Path::new("test.dart")));
        assert!(registry.can_parse(Path::new("test.zig")));
        assert!(registry.can_parse(Path::new("test.lua")));
        assert!(registry.can_parse(Path::new("Service.groovy")));
        assert!(registry.can_parse(Path::new("build.gradle")));
        assert!(registry.can_parse(Path::new("test.R")));
        assert!(registry.can_parse(Path::new("test.scala")));
        assert!(!registry.can_parse(Path::new("test.txt")));
        assert!(!registry.can_parse(Path::new("test.md")));
    }

    #[test]
    fn test_all_metrics() {
        let registry = ParserRegistry::new();
        let metrics = registry.all_metrics();
        assert_eq!(metrics.len(), 38);
        let names: Vec<&str> = metrics.iter().map(|(n, _)| *n).collect();
        assert_eq!(
            names,
            vec![
                "bash",
                "c",
                "clojure",
                "cobol",
                "cpp",
                "css",
                "csharp",
                "dart",
                "dockerfile",
                "elixir",
                "elm",
                "erlang",
                "fortran",
                "go",
                "groovy",
                "haskell",
                "hcl",
                "java",
                "julia",
                "kotlin",
                "lua",
                "objc",
                "ocaml",
                "perl",
                "php",
                "python",
                "r",
                "ruby",
                "rust",
                "scala",
                "solidity",
                "swift",
                "tcl",
                "toml",
                "typescript",
                "verilog",
                "yaml",
                "zig",
            ]
        );
    }

    #[test]
    fn test_language_for_path() {
        let registry = ParserRegistry::new();
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.c")),
            Some("c")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.h")),
            Some("c")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.cob")),
            Some("cobol")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.cpp")),
            Some("cpp")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.cc")),
            Some("cpp")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.hpp")),
            Some("cpp")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.cs")),
            Some("csharp")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.f90")),
            Some("fortran")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.go")),
            Some("go")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("Test.java")),
            Some("java")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.kt")),
            Some("kotlin")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("index.php")),
            Some("php")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.py")),
            Some("python")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("app.rb")),
            Some("ruby")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.rs")),
            Some("rust")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.swift")),
            Some("swift")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("script.tcl")),
            Some("tcl")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.ts")),
            Some("typescript")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.js")),
            Some("javascript")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.tsx")),
            Some("typescript")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.jsx")),
            Some("javascript")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.sv")),
            Some("verilog")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.dart")),
            Some("dart")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.zig")),
            Some("zig")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.lua")),
            Some("lua")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("Service.groovy")),
            Some("groovy")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("build.gradle")),
            Some("groovy")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("test.R")),
            Some("r")
        );
        assert_eq!(
            registry.language_for_path(&PathBuf::from("Main.scala")),
            Some("scala")
        );
        assert_eq!(registry.language_for_path(&PathBuf::from("test.txt")), None);
    }

    #[test]
    fn test_parse_source_unsupported() {
        let registry = ParserRegistry::new();
        let mut graph = CodeGraph::in_memory().unwrap();
        let result = registry.parse_source("some content", Path::new("test.txt"), &mut graph);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_file() {
        let registry = ParserRegistry::new();
        let mut graph = CodeGraph::in_memory().unwrap();
        let mut temp_file = NamedTempFile::with_suffix(".py").unwrap();
        writeln!(temp_file, "def test_function():\n    pass").unwrap();
        let result = registry.parse_file(temp_file.path(), &mut graph);
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_file_unsupported() {
        let registry = ParserRegistry::new();
        let mut graph = CodeGraph::in_memory().unwrap();
        let mut temp_file = NamedTempFile::with_suffix(".txt").unwrap();
        writeln!(temp_file, "some text content").unwrap();
        let result = registry.parse_file(temp_file.path(), &mut graph);
        assert!(result.is_err());
    }
}
