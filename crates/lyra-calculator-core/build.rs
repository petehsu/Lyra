fn main() {
    cc::Build::new()
        .file("native/calculator_tokenizer.c")
        .include("native")
        .warnings(false)
        .compile("lyra_calculator_tokenizer");

    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .file("native/calculator_engine.cpp")
        .include("native")
        .warnings(false)
        .compile("lyra_calculator_engine");
}
