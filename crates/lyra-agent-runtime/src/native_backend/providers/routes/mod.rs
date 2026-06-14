pub(crate) mod anthropic;
pub(crate) mod aws_bedrock;
pub(crate) mod custom_anthropic_compatible;
pub(crate) mod custom_openai_compatible;
pub(crate) mod google_gemini;
pub(crate) mod hosted_openai;
pub(crate) mod llama_cpp_server;
pub(crate) mod lmstudio;
pub(crate) mod local_openai_compatible;
pub(crate) mod mimo;
pub(crate) mod model_discovery;
pub(crate) mod ollama;
pub(crate) mod openai;
pub(crate) mod openrouter;
pub(crate) mod vllm;

pub(crate) use hosted_openai::HostedOpenAiRouteHook;
pub(crate) use model_discovery::RouteModelDiscoveryHook;
