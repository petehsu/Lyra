use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn use_out_dir_for_cc_temp() {
    // ponytail: gcc writes `.s` under TMPDIR. This host mounts /tmp as tmpfs
    // with usrquota; Cursor's sandbox cache fills the quota and the compile
    // dies with "Disk quota exceeded". Keep assembler scratch next to OUT_DIR
    // (project disk). If that disk is also quota-limited, raise the quota
    // instead of sending gcc back to /tmp.
    let out = env::var("OUT_DIR").expect("OUT_DIR");
    let tmp = PathBuf::from(out).join("cc-tmp");
    std::fs::create_dir_all(&tmp).expect("create cc-tmp");
    env::set_var("TMPDIR", &tmp);
    env::set_var("TEMP", &tmp);
    env::set_var("TMP", &tmp);
}

fn main() {
    use_out_dir_for_cc_temp();
    println!("cargo:rerun-if-changed=native/tile_kernel.cpp");
    println!("cargo:rerun-if-changed=native/tile_kernel.h");
    println!("cargo:rerun-if-changed=native/oiio_bridge.cpp");
    println!("cargo:rerun-if-changed=native/oiio_bridge.h");
    println!("cargo:rerun-if-changed=native/tiff_bridge.cpp");
    println!("cargo:rerun-if-changed=native/tiff_bridge.h");
    println!("cargo:rerun-if-env-changed=LYRA_OPENIMAGEIO_DIR");
    println!("cargo:rerun-if-env-changed=OPENIMAGEIO_DIR");
    println!("cargo:rerun-if-env-changed=OIIO_DIR");
    println!("cargo:rerun-if-env-changed=LYRA_LIBTIFF_DIR");
    println!("cargo:rerun-if-env-changed=LIBTIFF_DIR");
    println!("cargo:rerun-if-env-changed=PKG_CONFIG_PATH");
    println!("cargo:rustc-check-cfg=cfg(lyra_image_oiio)");
    println!("cargo:rustc-check-cfg=cfg(lyra_image_libtiff)");

    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .file("native/tile_kernel.cpp")
        .include("native")
        .warnings(false)
        .compile("lyra_image_tile_kernel");

    if let Some(oiio) = find_openimageio() {
        let mut build = cc::Build::new();
        build
            .cpp(true)
            .std("c++17")
            .file("native/oiio_bridge.cpp")
            .include("native")
            .include(&oiio.include_dir)
            .warnings(false);
        build.compile("lyra_image_oiio_bridge");

        println!("cargo:rustc-cfg=lyra_image_oiio");
        emit_link_search(&oiio.lib_dir);
        println!("cargo:rustc-link-lib=dylib=OpenImageIO");
        if has_named_library(&oiio.lib_dir, "OpenImageIO_Util") {
            println!("cargo:rustc-link-lib=dylib=OpenImageIO_Util");
        }
        emit_rpath(&oiio.lib_dir);
    }

    if let Some(libtiff) = find_libtiff() {
        let mut build = cc::Build::new();
        build
            .cpp(true)
            .std("c++17")
            .file("native/tiff_bridge.cpp")
            .include("native")
            .include(&libtiff.include_dir)
            .warnings(false);
        build.compile("lyra_image_tiff_bridge");

        println!("cargo:rustc-cfg=lyra_image_libtiff");
        emit_link_search(&libtiff.lib_dir);
        println!("cargo:rustc-link-lib=dylib=tiff");
        emit_rpath(&libtiff.lib_dir);
    }
}

struct NativeLibLocation {
    include_dir: PathBuf,
    lib_dir: PathBuf,
}

fn find_openimageio() -> Option<NativeLibLocation> {
    if let Some(found) = candidate_vendor_roots()
        .into_iter()
        .filter_map(|root| location_for_root(&root, "OpenImageIO/imagecache.h", "OpenImageIO"))
        .next()
    {
        return Some(normalize_oiio_include(found));
    }
    for package in [
        "OpenImageIO",
        "OpenImageIO-2.5",
        "OpenImageIO-2.4",
        "libOpenImageIO",
    ] {
        if let Some(found) = location_from_pkg_config(
            package,
            &["OpenImageIO/imagecache.h", "imagecache.h"],
            &["OpenImageIO"],
        ) {
            return Some(normalize_oiio_include(found));
        }
    }
    candidate_oiio_roots()
        .into_iter()
        .filter_map(|root| location_for_root(&root, "OpenImageIO/imagecache.h", "OpenImageIO"))
        .next()
}

fn find_libtiff() -> Option<NativeLibLocation> {
    if let Some(found) = candidate_vendor_roots()
        .into_iter()
        .filter_map(|root| location_for_root(&root, "tiffio.h", "tiff"))
        .next()
    {
        return Some(found);
    }
    for package in ["libtiff-4", "libtiff"] {
        if let Some(found) = location_from_pkg_config(package, &["tiffio.h"], &["tiff"]) {
            return Some(found);
        }
    }
    candidate_libtiff_roots()
        .into_iter()
        .filter_map(|root| location_for_root(&root, "tiffio.h", "tiff"))
        .next()
}

fn normalize_oiio_include(found: NativeLibLocation) -> NativeLibLocation {
    if found
        .include_dir
        .join("OpenImageIO")
        .join("imagecache.h")
        .exists()
    {
        return found;
    }
    if found.include_dir.join("imagecache.h").exists() {
        if let Some(parent) = found.include_dir.parent() {
            return NativeLibLocation {
                include_dir: parent.to_path_buf(),
                lib_dir: found.lib_dir,
            };
        }
    }
    found
}

fn location_from_pkg_config(
    package: &str,
    header_rel_paths: &[&str],
    lib_names: &[&str],
) -> Option<NativeLibLocation> {
    if pkg_config_exists(package) == false {
        return None;
    }
    let include_candidates = pkg_config_path_list(package, "--cflags-only-I", "-I");
    let mut include_candidates = include_candidates;
    if let Some(includedir) = pkg_config_variable(package, "includedir") {
        include_candidates.push(includedir);
    }
    let mut lib_candidates = pkg_config_path_list(package, "--libs-only-L", "-L");
    if let Some(libdir) = pkg_config_variable(package, "libdir") {
        lib_candidates.push(libdir);
    }
    let include_dir = include_candidates.into_iter().find(|dir| {
        header_rel_paths
            .iter()
            .any(|relative| dir.join(relative).exists())
    })?;
    let lib_dir = lib_candidates
        .into_iter()
        .find(|dir| lib_names.iter().any(|name| has_named_library(dir, name)))?;
    Some(NativeLibLocation {
        include_dir,
        lib_dir,
    })
}

fn location_for_root(root: &Path, header_rel: &str, lib_name: &str) -> Option<NativeLibLocation> {
    let include_dir = include_dirs(root)
        .into_iter()
        .find(|dir| dir.join(header_rel).exists())?;
    let lib_dir = lib_dirs(root)
        .into_iter()
        .find(|dir| has_named_library(dir, lib_name))?;
    Some(NativeLibLocation {
        include_dir,
        lib_dir,
    })
}

fn candidate_vendor_roots() -> Vec<PathBuf> {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let repo = manifest.join("../..");
    vec![
        repo.join("third-party/native/image-codecs/linux-x64/usr"),
        repo.join("third-party/native/image-codecs/usr"),
    ]
}

fn candidate_oiio_roots() -> Vec<PathBuf> {
    let mut roots = env_roots(&["LYRA_OPENIMAGEIO_DIR", "OPENIMAGEIO_DIR", "OIIO_DIR"]);
    if is_cross_compiling() {
        return roots;
    }
    roots.extend(brew_prefix("openimageio"));
    roots.extend(host_roots());
    roots.extend([
        PathBuf::from("/opt/homebrew/opt/openimageio"),
        PathBuf::from("/usr/local/opt/openimageio"),
        PathBuf::from("/opt/homebrew"),
        PathBuf::from("/usr/local"),
        PathBuf::from("/usr"),
    ]);
    roots
}

fn candidate_libtiff_roots() -> Vec<PathBuf> {
    let mut roots = env_roots(&["LYRA_LIBTIFF_DIR", "LIBTIFF_DIR"]);
    if is_cross_compiling() {
        return roots;
    }
    roots.extend(brew_prefix("libtiff"));
    roots.extend(host_roots());
    roots.extend([
        PathBuf::from("/opt/homebrew/opt/libtiff"),
        PathBuf::from("/usr/local/opt/libtiff"),
        PathBuf::from("/opt/homebrew"),
        PathBuf::from("/usr/local"),
        PathBuf::from("/usr"),
    ]);
    roots
}

fn env_roots(keys: &[&str]) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in keys {
        if let Ok(value) = env::var(key) {
            let trimmed = value.trim();
            if trimmed.is_empty() == false {
                roots.push(PathBuf::from(trimmed));
            }
        }
    }
    roots
}

fn brew_prefix(formula: &str) -> Vec<PathBuf> {
    let output = Command::new("brew").args(["--prefix", formula]).output();
    match output {
        Ok(output) if output.status.success() => String::from_utf8(output.stdout)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| value.is_empty() == false)
            .map(PathBuf::from)
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

fn host_roots() -> Vec<PathBuf> {
    vec![PathBuf::from("/usr"), PathBuf::from("/usr/local")]
}

fn include_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![root.join("include")];
    for multiarch in multiarch_triples() {
        dirs.push(root.join("include").join(multiarch));
    }
    dirs
}

fn lib_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![root.join("lib"), root.join("lib64")];
    for multiarch in multiarch_triples() {
        dirs.push(root.join("lib").join(multiarch));
    }
    dirs
}

fn multiarch_triples() -> Vec<String> {
    match env::var("CARGO_CFG_TARGET_ARCH")
        .unwrap_or_default()
        .as_str()
    {
        "x86_64" => vec!["x86_64-linux-gnu".to_string()],
        "aarch64" => vec!["aarch64-linux-gnu".to_string()],
        "arm" => vec!["arm-linux-gnueabihf".to_string()],
        other if other.is_empty() == false => vec![format!("{other}-linux-gnu")],
        _ => vec![
            "x86_64-linux-gnu".to_string(),
            "aarch64-linux-gnu".to_string(),
        ],
    }
}

fn has_named_library(lib_dir: &Path, name: &str) -> bool {
    let exact = [
        format!("lib{name}.so"),
        format!("lib{name}.dylib"),
        format!("lib{name}.a"),
        format!("{name}.lib"),
    ];
    if exact
        .iter()
        .any(|file_name| lib_dir.join(file_name).exists())
    {
        return true;
    }
    let prefix = format!("lib{name}.so.");
    std::fs::read_dir(lib_dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|file_name| file_name.starts_with(&prefix))
        })
}

fn pkg_config_exists(package: &str) -> bool {
    Command::new("pkg-config")
        .args(["--exists", package])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn pkg_config_variable(package: &str, variable: &str) -> Option<PathBuf> {
    let output = Command::new("pkg-config")
        .args(["--variable", variable, package])
        .output()
        .ok()?;
    if output.status.success() == false {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

fn pkg_config_path_list(package: &str, flag: &str, prefix: &str) -> Vec<PathBuf> {
    let output = Command::new("pkg-config").args([flag, package]).output();
    match output {
        Ok(output) if output.status.success() => String::from_utf8(output.stdout)
            .ok()
            .map(|value| {
                value
                    .split_whitespace()
                    .filter_map(|token| token.strip_prefix(prefix).map(PathBuf::from))
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn emit_link_search(lib_dir: &Path) {
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
}

fn emit_rpath(lib_dir: &Path) {
    if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib_dir.display());
    }
}

fn is_cross_compiling() -> bool {
    env::var("HOST").ok() != env::var("TARGET").ok()
}
