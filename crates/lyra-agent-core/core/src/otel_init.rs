use crate::config::Config;
use lyra_config::types::OtelExporterKind as Kind;
use lyra_config::types::OtelHttpProtocol as Protocol;
use lyra_features::Feature;
use lyra_login::default_client::client_identity;
use lyra_otel::OtelExporter;
use lyra_otel::OtelHttpProtocol;
use lyra_otel::OtelProvider;
use lyra_otel::OtelSettings;
use lyra_otel::OtelTlsConfig as OtelTlsSettings;
use std::error::Error;

/// Build an OpenTelemetry provider from the app Config.
///
/// Returns `None` when OTEL export is disabled.
pub fn build_provider(
    config: &Config,
    service_version: &str,
    service_name_override: Option<&str>,
    default_analytics_enabled: bool,
) -> Result<Option<OtelProvider>, Box<dyn Error>> {
    let to_otel_exporter = |kind: &Kind| match kind {
        Kind::None => OtelExporter::None,
        Kind::Statsig => OtelExporter::Statsig,
        Kind::OtlpHttp {
            endpoint,
            headers,
            protocol,
            tls,
        } => {
            let protocol = match protocol {
                Protocol::Json => OtelHttpProtocol::Json,
                Protocol::Binary => OtelHttpProtocol::Binary,
            };

            OtelExporter::OtlpHttp {
                endpoint: endpoint.clone(),
                headers: headers
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
                protocol,
                tls: tls.as_ref().map(|config| OtelTlsSettings {
                    ca_certificate: config.ca_certificate.clone(),
                    client_certificate: config.client_certificate.clone(),
                    client_private_key: config.client_private_key.clone(),
                }),
            }
        }
        Kind::OtlpGrpc {
            endpoint,
            headers,
            tls,
        } => OtelExporter::OtlpGrpc {
            endpoint: endpoint.clone(),
            headers: headers
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            tls: tls.as_ref().map(|config| OtelTlsSettings {
                ca_certificate: config.ca_certificate.clone(),
                client_certificate: config.client_certificate.clone(),
                client_private_key: config.client_private_key.clone(),
            }),
        },
    };

    let exporter = to_otel_exporter(&config.otel.exporter);
    let trace_exporter = to_otel_exporter(&config.otel.trace_exporter);
    let metrics_exporter = if config
        .analytics_enabled
        .unwrap_or(default_analytics_enabled)
    {
        to_otel_exporter(&config.otel.metrics_exporter)
    } else {
        OtelExporter::None
    };

    let client_name = client_identity();
    let service_name = service_name_override.unwrap_or(client_name.as_str());
    let runtime_metrics = config.features.enabled(Feature::RuntimeMetrics);

    OtelProvider::from(&OtelSettings {
        service_name: service_name.to_string(),
        service_version: service_version.to_string(),
        lyra_home: config.lyra_home.to_path_buf(),
        environment: config.otel.environment.to_string(),
        exporter,
        trace_exporter,
        metrics_exporter,
        runtime_metrics,
    })
}

/// Filter predicate for exporting only Lyra-owned events via OTEL.
/// Keeps events that originated from lyra_otel module
pub fn lyra_export_filter(meta: &tracing::Metadata<'_>) -> bool {
    meta.target().starts_with("lyra_otel")
}
