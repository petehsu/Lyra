use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
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
        println!("cargo:rustc-link-search=native={}", oiio.lib_dir.display());
        println!("cargo:rustc-link-lib=dylib=OpenImageIO");
        println!("cargo:rustc-link-lib=dylib=OpenImageIO_Util");
        if cfg!(target_os = "macos") {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", oiio.lib_dir.display());
        }
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
        println!("cargo:rustc-link-search=native={}", libtiff.lib_dir.display());
        println!("cargo:rustc-link-lib=dylib=tiff");
        if cfg!(target_os = "macos") {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", libtiff.lib_dir.display());
        }
    }
}

struct OiioLocation {
    include_dir: PathBuf,
    lib_dir: PathBuf,
}

fn find_openimageio() -> Option<OiioLocation> {
    candidate_roots()
        .into_iter()
        .filter_map(|root| oiio_location_for_root(&root))
        .next()
}

fn candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in ["LYRA_OPENIMAGEIO_DIR", "OPENIMAGEIO_DIR", "OIIO_DIR"] {
        if let Ok(value) = env::var(key) {
            let trimmed = value.trim();
            if trimmed.is_empty() == false {
                roots.push(PathBuf::from(trimmed));
            }
        }
    }

    if let Ok(output) = Command::new("brew").args(["--prefix", "openimageio"]).output() {
        if output.status.success() {
            if let Ok(value) = String::from_utf8(output.stdout) {
                let trimmed = value.trim();
                if trimmed.is_empty() == false {
                    roots.push(PathBuf::from(trimmed));
                }
            }
        }
    }

    roots.extend([
        PathBuf::from("/opt/homebrew/opt/openimageio"),
        PathBuf::from("/usr/local/opt/openimageio"),
        PathBuf::from("/opt/homebrew"),
        PathBuf::from("/usr/local"),
    ]);
    roots
}

fn oiio_location_for_root(root: &Path) -> Option<OiioLocation> {
    let include_dir = root.join("include");
    let lib_dir = root.join("lib");
    let header = include_dir.join("OpenImageIO").join("imagecache.h");
    if header.exists() == false || has_oiio_library(&lib_dir) == false {
        return None;
    }
    Some(OiioLocation {
        include_dir,
        lib_dir,
    })
}

fn has_oiio_library(lib_dir: &Path) -> bool {
    [
        "libOpenImageIO.dylib",
        "libOpenImageIO.so",
        "libOpenImageIO.a",
    ]
    .into_iter()
    .any(|name| lib_dir.join(name).exists())
}

fn find_libtiff() -> Option<OiioLocation> {
    candidate_libtiff_roots()
        .into_iter()
        .filter_map(|root| libtiff_location_for_root(&root))
        .next()
}

fn candidate_libtiff_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in ["LYRA_LIBTIFF_DIR", "LIBTIFF_DIR"] {
        if let Ok(value) = env::var(key) {
            let trimmed = value.trim();
            if trimmed.is_empty() == false {
                roots.push(PathBuf::from(trimmed));
            }
        }
    }
    if let Ok(output) = Command::new("brew").args(["--prefix", "libtiff"]).output() {
        if output.status.success() {
            if let Ok(value) = String::from_utf8(output.stdout) {
                let trimmed = value.trim();
                if trimmed.is_empty() == false {
                    roots.push(PathBuf::from(trimmed));
                }
            }
        }
    }
    roots.extend([
        PathBuf::from("/opt/homebrew/opt/libtiff"),
        PathBuf::from("/usr/local/opt/libtiff"),
        PathBuf::from("/opt/homebrew"),
        PathBuf::from("/usr/local"),
    ]);
    roots
}

fn libtiff_location_for_root(root: &Path) -> Option<OiioLocation> {
    let include_dir = root.join("include");
    let lib_dir = root.join("lib");
    if include_dir.join("tiffio.h").exists() == false || has_libtiff_library(&lib_dir) == false {
        return None;
    }
    Some(OiioLocation {
        include_dir,
        lib_dir,
    })
}

fn has_libtiff_library(lib_dir: &Path) -> bool {
    [
        "libtiff.dylib",
        "libtiff.so",
        "libtiff.a",
    ]
    .into_iter()
    .any(|name| lib_dir.join(name).exists())
}
