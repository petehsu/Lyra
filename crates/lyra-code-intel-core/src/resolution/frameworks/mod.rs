//! Framework resolver implementations.
//!
//! One file per language group, matching the codegraph-colby reference.
//! Each resolver implements `FrameworkResolver` with detect/extract/resolve.

// Re-export helpers so framework files can use `super::helpers::...`.
pub use super::helpers;

pub mod express;
pub mod nestjs;
pub mod react;
pub mod svelte;
pub mod vue;
pub mod astro;
pub mod python;
pub mod ruby;
pub mod java;
pub mod play;
pub mod go;
pub mod goframe;
pub mod rust;
pub mod csharp;
pub mod swift;
pub mod php;
pub mod swift_objc;
pub mod react_native;
pub mod expo_modules;
pub mod fabric;