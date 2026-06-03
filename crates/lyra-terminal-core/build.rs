fn main() {
    if std::env::var_os("CARGO_FEATURE_NODE_API").is_some() {
        napi_build::setup();
        if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
            println!("cargo:rustc-link-arg=-undefined");
            println!("cargo:rustc-link-arg=dynamic_lookup");
        }
    }
}
