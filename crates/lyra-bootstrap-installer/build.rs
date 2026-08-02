fn main() {
    println!("cargo:rustc-check-cfg=cfg(lyra_embedded_offline_bundle)");
    println!("cargo:rerun-if-env-changed=LYRA_INSTALLER_CATALOG_URL");
    println!("cargo:rerun-if-env-changed=LYRA_INSTALLER_TRUSTED_ROOTS_JSON");
    println!("cargo:rerun-if-env-changed=LYRA_INSTALLER_OFFLINE_BUNDLE_ZIP");
    if let Some(bundle) = std::env::var_os("LYRA_INSTALLER_OFFLINE_BUNDLE_ZIP") {
        let bundle = std::path::PathBuf::from(bundle);
        if !bundle.is_file() {
            panic!(
                "LYRA_INSTALLER_OFFLINE_BUNDLE_ZIP is not a file: {}",
                bundle.display()
            );
        }
        let bundle = bundle
            .canonicalize()
            .unwrap_or_else(|error| panic!("cannot resolve embedded offline bundle: {error}"));
        println!("cargo:rerun-if-changed={}", bundle.display());
        println!(
            "cargo:rustc-env=LYRA_INSTALLER_OFFLINE_BUNDLE_PATH={}",
            bundle.display()
        );
        println!("cargo:rustc-cfg=lyra_embedded_offline_bundle");
    }
    if let Err(error) = slint_build::compile("ui/installer.slint") {
        panic!("cannot compile Lyra installer UI: {error}");
    }
}
