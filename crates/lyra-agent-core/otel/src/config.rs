use std::collections::HashMap;
use std::path::PathBuf;

use lyra_utils_absolute_path::AbsolutePathBuf;

pub(crate) fn resolve_exporter(exporter: &OtelExporter) -> OtelExporter {
    match exporter {
        OtelExporter::Statsig => OtelExporter::None,
        _ => exporter.clone(),
    }
}

#[derive(Clone, Debug)]
pub struct OtelSettings {
    pub environment: String,
    pub service_name: String,
    pub service_version: String,
    pub lyra_home: PathBuf,
    pub exporter: OtelExporter,
    pub trace_exporter: OtelExporter,
    pub metrics_exporter: OtelExporter,
    pub runtime_metrics: bool,
}

#[derive(Clone, Debug)]
pub enum OtelHttpProtocol {
    /// HTTP protocol with binary protobuf
    Binary,
    /// HTTP protocol with JSON payload
    Json,
}

#[derive(Clone, Debug, Default)]
pub struct OtelTlsConfig {
    pub ca_certificate: Option<AbsolutePathBuf>,
    pub client_certificate: Option<AbsolutePathBuf>,
    pub client_private_key: Option<AbsolutePathBuf>,
}

#[derive(Clone, Debug)]
pub enum OtelExporter {
    None,
    /// Statsig metrics ingestion exporter using Lyra-internal defaults.
    ///
    /// This is intended for metrics only.
    Statsig,
    OtlpGrpc {
        endpoint: String,
        headers: HashMap<String, String>,
        tls: Option<OtelTlsConfig>,
    },
    OtlpHttp {
        endpoint: String,
        headers: HashMap<String, String>,
        protocol: OtelHttpProtocol,
        tls: Option<OtelTlsConfig>,
    },
}

#[cfg(test)]
mod tests {
    use super::OtelExporter;
    use super::resolve_exporter;

    #[test]
    fn statsig_exporter_resolves_to_none() {
        assert!(matches!(
            resolve_exporter(&OtelExporter::Statsig),
            OtelExporter::None
        ));
    }
}
