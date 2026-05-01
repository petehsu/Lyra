fn main() {
    cc::Build::new()
        .cpp(true)
        .file("native/resource_kernel.cpp")
        .include("native")
        .warnings(false)
        .compile("lyra_resource_kernel");
}
