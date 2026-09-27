//! Offline diagnostic for the repeated context accounting in an agent loop.
fn main() {
    let messages: Vec<String> = (0..80).map(|index| (0..45).map(|row| format!(
        "{index}:{row} [targetRef=lumen:row{row}] button: 创建访问令牌, enabled=true. Input value is ordinary test content.\n"
    )).collect()).collect();
    let _ = lyra_agent_reader::estimate_tokens("warm tokenizer initialization");
    for round in 0..3 {
        let start = std::time::Instant::now();
        let tokens: usize = messages
            .iter()
            .map(|text| lyra_agent_reader::estimate_tokens(text))
            .sum();
        println!(
            "round={round} messages={} tokens={tokens} elapsed_ms={:.3}",
            messages.len(),
            start.elapsed().as_secs_f64() * 1000.0
        );
    }
}
