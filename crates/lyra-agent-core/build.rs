fn main() {
    println!("cargo:rustc-env=JCODE_GIT_HASH=lyra-vendored");
    println!("cargo:rustc-env=JCODE_VERSION=0.12.0-lyra");
    println!("cargo:rustc-env=JCODE_UPDATE_SEMVER=0.12.0-lyra");
}
