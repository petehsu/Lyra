fn main() {
    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .file("native/resource_kernel.cpp")
        .include("native")
        .warnings(false)
        .compile("lyra_resource_kernel");
}
