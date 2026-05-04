fn main() {
    cc::Build::new()
        .file("native/download_scheme.c")
        .include("native")
        .warnings(false)
        .compile("lyra_download_scheme");

    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .file("native/download_segment_planner.cpp")
        .include("native")
        .warnings(false)
        .compile("lyra_download_segment_planner");
}
