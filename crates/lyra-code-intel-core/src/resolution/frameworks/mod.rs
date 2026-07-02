//! Framework resolver implementations.
//!
//! One file per language group, matching the codegraph-colby reference.
//! Each resolver implements `FrameworkResolver` with detect/extract/resolve.

// Re-export helpers so framework files can use `super::helpers::...`.
pub use super::helpers;

pub mod astro;
pub mod csharp;
pub mod expo_modules;
pub mod express;
pub mod fabric;
pub mod go;
pub mod goframe;
pub mod java;
pub mod nestjs;
pub mod php;
pub mod play;
pub mod python;
pub mod react;
pub mod react_native;
pub mod ruby;
pub mod rust;
pub mod svelte;
pub mod swift;
pub mod swift_objc;
pub mod vue;
