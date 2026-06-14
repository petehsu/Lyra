use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "aws_bedrock";
pub(crate) const DEFAULT_BASE_URL: &str = "https://bedrock-runtime.us-east-1.amazonaws.com";

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "aws_bedrock".to_string(),
        protocol_id: protocol::aws_bedrock_converse::PROTOCOL_ID.to_string(),
        protocol_family: protocol::aws_bedrock_converse::PROTOCOL_FAMILY.to_string(),
        label: "AWS Bedrock".to_string(),
        description: "AWS Bedrock Runtime Converse API route signed with SigV4.".to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
        api_method: "converse".to_string(),
        auth_kind: "aws_sigv4_env".to_string(),
        runtime_supported: true,
        model_discovery_supported: false,
        custom_headers_supported: false,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: false,
    }
}
