fn main() {
    cc::Build::new()
        .file("native/local_search_scorer.c")
        .warnings(false)
        .compile("lyra_local_search_scorer");
}
