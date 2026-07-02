//! Framework resolver registry.
//!
//! Port of codegraph-colby's `frameworks/index.ts` — the registry holds
//! all 25 framework resolvers. `detect_all` returns the subset that matches
//! the current project.

use std::sync::Arc;

use super::types::{FrameworkResolver, ResolutionContext};

// Framework resolver implementations.
use super::frameworks::{
    astro::AstroResolver,
    csharp::AspNetResolver,
    expo_modules::ExpoModulesResolver,
    express::ExpressResolver,
    fabric::FabricViewResolver,
    go::GoResolver,
    goframe::GoFrameResolver,
    java::SpringResolver,
    nestjs::NestjsResolver,
    php::{DrupalResolver, LaravelResolver},
    play::PlayResolver,
    python::{DjangoResolver, FastApiResolver, FlaskResolver},
    react::ReactResolver,
    react_native::ReactNativeBridgeResolver,
    ruby::RailsResolver,
    rust::RustResolver,
    svelte::SvelteResolver,
    swift::{SwiftUiResolver, UiKitResolver, VaporResolver},
    swift_objc::SwiftObjcBridgeResolver,
    vue::VueResolver,
};

pub struct FrameworkRegistry {
    resolvers: Vec<Arc<dyn FrameworkResolver>>,
}

impl FrameworkRegistry {
    pub fn new() -> Self {
        Self {
            resolvers: vec![
                // PHP
                Arc::new(LaravelResolver),
                Arc::new(DrupalResolver),
                // JavaScript/TypeScript
                Arc::new(ExpressResolver),
                Arc::new(NestjsResolver),
                Arc::new(ReactResolver),
                Arc::new(SvelteResolver),
                Arc::new(VueResolver),
                Arc::new(AstroResolver),
                // Python
                Arc::new(DjangoResolver),
                Arc::new(FlaskResolver),
                Arc::new(FastApiResolver),
                // Ruby
                Arc::new(RailsResolver),
                // Java
                Arc::new(SpringResolver),
                Arc::new(PlayResolver),
                // Go
                Arc::new(GoResolver),
                Arc::new(GoFrameResolver),
                // Rust
                Arc::new(RustResolver),
                // C#
                Arc::new(AspNetResolver),
                // Swift
                Arc::new(SwiftUiResolver),
                Arc::new(UiKitResolver),
                Arc::new(VaporResolver),
                // Cross-language bridges
                Arc::new(SwiftObjcBridgeResolver),
                Arc::new(ReactNativeBridgeResolver),
                Arc::new(ExpoModulesResolver),
                Arc::new(FabricViewResolver),
            ],
        }
    }

    /// Return all resolvers whose `detect` returns true for this project.
    pub fn detect_all(&self, ctx: &ResolutionContext) -> Vec<Arc<dyn FrameworkResolver>> {
        self.resolvers
            .iter()
            .filter(|r| r.detect(ctx))
            .cloned()
            .collect()
    }
}

impl Default for FrameworkRegistry {
    fn default() -> Self {
        Self::new()
    }
}
