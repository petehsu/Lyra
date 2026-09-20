/// Socket-family prefixes `lyrad` may route. Generated inventories and
/// `docs/contracts/runtime-socket.md` must not name a family outside this table.
pub const RUNTIME_METHOD_FAMILIES: &[&str] = &[
    "runtime.",
    "agent.",
    "terminal.",
    "download.",
    "lsp.",
    "search.",
    "files.",
    "performance.",
];

pub fn runtime_method_family(method: &str) -> Option<&'static str> {
    RUNTIME_METHOD_FAMILIES
        .iter()
        .copied()
        .find(|family| method.starts_with(family))
}

pub fn is_known_runtime_family(method: &str) -> bool {
    runtime_method_family(method).is_some()
}

#[cfg(test)]
mod tests {
    use super::{is_known_runtime_family, RUNTIME_METHOD_FAMILIES};

    #[test]
    fn families_are_the_socket_waist() {
        assert!(RUNTIME_METHOD_FAMILIES.contains(&"files."));
        assert!(!RUNTIME_METHOD_FAMILIES.iter().any(|family| family.starts_with("code")));
        assert!(is_known_runtime_family("files.read_directory"));
        assert!(is_known_runtime_family("runtime.handshake"));
        assert!(!is_known_runtime_family("code.applyPatch"));
        assert!(!is_known_runtime_family("window.setMaterial"));
    }
}
