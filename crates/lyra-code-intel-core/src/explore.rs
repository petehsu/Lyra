use codegraph::NodeId;
use codegraph_server::ai_query::{CallInfo, SymbolInfo};
use serde::Serialize;

/// One symbol hit from `explore`, enriched with its direct callers/callees.
/// This is the "one call returns everything" shape from the plan's Phase 6
/// design philosophy.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreSymbol {
    pub symbol: SymbolInfo,
    pub score: f32,
    pub match_reason: String,
    pub callers: Vec<CallInfo>,
    pub callees: Vec<CallInfo>,
}

/// A synthesized edge — created by framework resolvers, not tree-sitter.
/// `provenance: "heuristic"` in edge properties marks these.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizedEdge {
    pub from_node_id: NodeId,
    pub to_node_id: NodeId,
    pub edge_type: String,
    pub from_name: String,
    pub to_name: String,
    pub synthesized_by: String,
}

/// Unified query result from `CodeGraphEngine::explore`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreResult {
    pub query: String,
    pub symbols: Vec<ExploreSymbol>,
    pub total_matches: usize,
    pub elapsed_ms: u64,
    pub synthesized_edges: Vec<SynthesizedEdge>,
}
