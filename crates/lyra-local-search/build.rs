fn main() {
    cc::Build::new()
        .file("native/local_search_tokenizer.c")
        .include("native")
        .warnings(false)
        .compile("lyra_local_search_tokenizer");

    cc::Build::new()
        .cpp(true)
        .file("native/local_search_ranker.cpp")
        .include("native")
        .warnings(false)
        .compile("lyra_local_search_ranker");
}
