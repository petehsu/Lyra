import type {
  LocalizedText,
  ProviderRecord
} from "./types";

const text = (en: string, zh: string): LocalizedText => ({
  "en-US": en,
  "zh-CN": zh
});

const cloudAi = (
  id: string,
  provider: string,
  privacyUrl: string | null
): ProviderRecord => ({
  id,
  provider,
  service: text(
    "Selectable cloud AI model endpoint",
    "可选择的云端 AI 模型端点"
  ),
  data: text(
    "Prompts and the Agent/model context selected or assembled for a turn, which can include content, tools, derived Persona, device/screen/timezone context, and authorized location labels.",
    "为轮次选择或组装的提示词与 Agent/模型上下文，可能包括内容、工具、推导 Persona、设备/屏幕/时区上下文及经授权的位置标签。"
  ),
  region: text(
    "Provider-controlled; exact processing locations and subprocessors are not verified for release.",
    "由服务商控制；确切处理地点及子处理者尚未完成发布核验。"
  ),
  privacyUrl,
  trainingAndRetention: text(
    "Depends on the provider product, account tier, endpoint and user settings; Lyra has not verified a release-wide no-training or retention commitment.",
    "取决于服务商产品、账户层级、端点及用户设置；Lyra 尚未核验覆盖发布版本的“不训练”或保留承诺。"
  ),
  dpaStatus: text(
    "Not confirmed for Lyra; release review pending.",
    "尚未针对 Lyra 确认；待发布审阅。"
  ),
  reviewStatus: "pending"
});

export const PROVIDER_RECORDS: readonly ProviderRecord[] = [
  {
    id: "supabase",
    provider: "Supabase",
    service: text(
      "Authentication, profile, and session backend",
      "身份认证、profile 与会话后端"
    ),
    data: text(
      "User and session identifiers, Google-linked email/name/avatar, locale, theme, onboarding state, and authentication metadata.",
      "用户与会话标识符、Google 关联邮箱/姓名/头像、语言、主题、引导状态和认证元数据。"
    ),
    region: text(
      "Required release field: project region has not been confirmed in the Supabase Dashboard and must not be guessed.",
      "发布必填字段：尚未在 Supabase Dashboard 确认项目地区，且不得猜测。"
    ),
    privacyUrl: "https://supabase.com/privacy",
    trainingAndRetention: text(
      "Controlled by project configuration, Supabase terms, backups, and retention practices; account deletion path is not yet verified.",
      "由项目配置、Supabase 条款、备份及保留做法控制；账户删除路径尚未核验。"
    ),
    dpaStatus: text(
      "DPA and current subprocessor list not confirmed for this project.",
      "本项目的 DPA 及当前子处理者清单尚未确认。"
    ),
    reviewStatus: "pending"
  },
  {
    id: "google-oauth",
    provider: "Google",
    service: text("OAuth sign-in", "OAuth 登录"),
    data: text(
      "OAuth identifiers and scopes, email, display name, avatar, and ordinary sign-in request metadata.",
      "OAuth 标识符与 scope、邮箱、显示名称、头像及通常登录请求元数据。"
    ),
    region: text(
      "Google-controlled global infrastructure; exact locations are not selected by Lyra.",
      "由 Google 控制的全球基础设施；确切地点并非由 Lyra 选择。"
    ),
    privacyUrl: "https://policies.google.com/privacy",
    trainingAndRetention: text(
      "Governed by Google account, OAuth, security, and retention policies.",
      "依 Google 账户、OAuth、安全及保留政策。"
    ),
    dpaStatus: text(
      "No Lyra-specific DPA confirmed; applicability under review.",
      "尚未确认 Lyra 专属 DPA；适用性待审阅。"
    ),
    reviewStatus: "pending"
  },
  cloudAi(
    "openai",
    "OpenAI",
    "https://openai.com/policies/privacy-policy/"
  ),
  cloudAi(
    "anthropic",
    "Anthropic",
    "https://www.anthropic.com/legal/privacy"
  ),
  cloudAi(
    "aws-bedrock",
    "Amazon Web Services (Bedrock)",
    "https://aws.amazon.com/privacy/"
  ),
  cloudAi(
    "google-gemini",
    "Google (Gemini API)",
    "https://policies.google.com/privacy"
  ),
  cloudAi(
    "openrouter",
    "OpenRouter",
    "https://openrouter.ai/privacy"
  ),
  cloudAi("deepseek", "DeepSeek", null),
  cloudAi("zhipu-glm", "Zhipu AI / Z.ai (GLM)", null),
  cloudAi("moonshot", "Moonshot AI / Kimi", null),
  cloudAi(
    "nvidia-nim",
    "NVIDIA NIM",
    "https://www.nvidia.com/en-us/about-nvidia/privacy-policy/"
  ),
  cloudAi(
    "xiaomi-mimo",
    "Xiaomi MiMo",
    "https://privacy.mi.com/all/en_US/"
  ),
  cloudAi("ollama-cloud", "Ollama Cloud", "https://ollama.com/privacy"),
  cloudAi("xai", "xAI", "https://x.ai/legal/privacy-policy"),
  cloudAi("mistral", "Mistral AI", "https://mistral.ai/terms#privacy-policy"),
  cloudAi("groq", "Groq", "https://groq.com/privacy-policy/"),
  cloudAi("cerebras", "Cerebras", null),
  cloudAi("cohere", "Cohere", "https://cohere.com/privacy"),
  cloudAi(
    "together-ai",
    "Together AI",
    "https://www.together.ai/privacy"
  ),
  cloudAi(
    "perplexity",
    "Perplexity",
    "https://www.perplexity.ai/hub/legal/privacy-policy"
  ),
  cloudAi("alibaba", "Alibaba Cloud / DashScope", null),
  cloudAi("deepinfra", "DeepInfra", "https://deepinfra.com/privacy"),
  cloudAi(
    "venice",
    "Venice",
    "https://venice.ai/legal/privacy-policy"
  ),
  {
    id: "custom-ai-endpoints",
    provider: "User-configured compatible endpoint",
    service: text(
      "Custom OpenAI-compatible or Anthropic-compatible model endpoint",
      "自定义 OpenAI-compatible 或 Anthropic-compatible 模型端点"
    ),
    data: text(
      "The same model request boundary described for cloud AI, plus configured headers and authentication data sent to the chosen endpoint.",
      "与云端 AI 相同的模型请求边界，以及发送至所选端点的已配置请求头和认证数据。"
    ),
    region: text(
      "Chosen and controlled by the user or endpoint operator; Lyra cannot determine it.",
      "由用户或端点运营者选择并控制；Lyra 无法确定。"
    ),
    privacyUrl: null,
    trainingAndRetention: text(
      "Entirely determined by the endpoint operator and configuration.",
      "完全由端点运营者及配置决定。"
    ),
    dpaStatus: text(
      "User responsibility; no Lyra DPA.",
      "由用户负责；不存在 Lyra DPA。"
    ),
    reviewStatus: "user-configured"
  },
  {
    id: "local-ai-runtimes",
    provider: "Ollama / LM Studio / llama.cpp / vLLM / local-compatible runtime",
    service: text("Local model runtime", "本地模型运行时"),
    data: text(
      "Model requests and context sent to the configured local address.",
      "发送至所配置本地地址的模型请求与上下文。"
    ),
    region: text(
      "Local only when the configured runtime/address truly remains on the device or trusted local network.",
      "仅当所配置运行时/地址确实位于设备或可信本地网络时才属于本地。"
    ),
    privacyUrl: null,
    trainingAndRetention: text(
      "Controlled by the selected local runtime, model, logging, and network configuration.",
      "由所选本地运行时、模型、日志及网络配置控制。"
    ),
    dpaStatus: text("Not applicable to Lyra.", "不适用于 Lyra。"),
    reviewStatus: "user-configured"
  },
  {
    id: "google-suggest",
    provider: "Google Suggest",
    service: text("Search suggestions while typing", "输入时的搜索建议"),
    data: text(
      "Typed query text after a short debounce and ordinary request metadata.",
      "短暂防抖后的已输入查询文本及通常请求元数据。"
    ),
    region: text("Google-controlled global infrastructure.", "Google 控制的全球基础设施。"),
    privacyUrl: "https://policies.google.com/privacy",
    trainingAndRetention: text(
      "Governed by Google’s service policies; Lyra has not verified a product-specific retention commitment.",
      "依 Google 服务政策；Lyra 尚未核验产品专属保留承诺。"
    ),
    dpaStatus: text(
      "No Lyra-specific DPA confirmed.",
      "尚未确认 Lyra 专属 DPA。"
    ),
    reviewStatus: "pending"
  },
  {
    id: "wikipedia",
    provider: "Wikimedia Foundation (Wikipedia)",
    service: text("Search suggestions and retrieved content", "搜索建议与检索内容"),
    data: text(
      "Typed query text, retrieved results, IP address, and ordinary request metadata.",
      "已输入查询文本、检索结果、IP 地址及通常请求元数据。"
    ),
    region: text("Wikimedia-controlled infrastructure.", "Wikimedia 控制的基础设施。"),
    privacyUrl: "https://foundation.wikimedia.org/wiki/Policy:Privacy_policy",
    trainingAndRetention: text(
      "Governed by Wikimedia’s privacy and log-retention practices.",
      "依 Wikimedia 隐私及日志保留做法。"
    ),
    dpaStatus: text(
      "No Lyra-specific DPA; applicability under review.",
      "不存在 Lyra 专属 DPA；适用性待审阅。"
    ),
    reviewStatus: "pending"
  },
  {
    id: "web-search-and-sites",
    provider: "Configured search service and visited websites",
    service: text("Web search and browsing", "网页搜索与浏览"),
    data: text(
      "Submitted queries, URLs, page requests, cookies/session data for the active profile, and ordinary network metadata.",
      "已提交查询、URL、网页请求、当前 profile 的 Cookie/会话数据及通常网络元数据。"
    ),
    region: text(
      "Controlled by each configured search provider and visited site.",
      "由各所配置搜索服务商及访问网站控制。"
    ),
    privacyUrl: null,
    trainingAndRetention: text(
      "Varies by provider and site; consult each destination.",
      "因服务商及网站而异；请查阅各目的地政策。"
    ),
    dpaStatus: text(
      "No general Lyra DPA; user-selected destinations.",
      "不存在通用 Lyra DPA；目的地由用户选择。"
    ),
    reviewStatus: "user-configured"
  },
  {
    id: "nominatim",
    provider: "OpenStreetMap Foundation public Nominatim service",
    service: text("Reverse geocoding", "逆地理编码"),
    data: text(
      "Exact latitude and longitude, locale, IP address, and ordinary request metadata when precise location is authorized.",
      "授权精确位置后发送的准确经纬度、区域语言、IP 地址及通常请求元数据。"
    ),
    region: text(
      "Public OSMF-operated infrastructure; exact request-processing location is not guaranteed.",
      "OSMF 运营的公共基础设施；不保证确切请求处理地点。"
    ),
    privacyUrl: "https://osmfoundation.org/wiki/Privacy_Policy",
    trainingAndRetention: text(
      "Subject to OSMF and public-service logs. The usage policy says not to submit personal or confidential data, creating an unresolved release risk for exact coordinates.",
      "依 OSMF 与公共服务日志政策。其使用政策要求不要提交个人或机密数据，因此精确坐标构成尚未解决的发布风险。"
    ),
    dpaStatus: text(
      "No DPA confirmed; use requires explicit legal review.",
      "尚未确认 DPA；相关使用须经明确法律审阅。"
    ),
    reviewStatus: "pending"
  },
  {
    id: "mcp-servers",
    provider: "User-configured MCP servers",
    service: text("Local or remote tools over MCP", "通过 MCP 提供的本地或远程工具"),
    data: text(
      "Server configuration, request headers/environment values, tool schemas, arguments, results, and any data a tool accesses.",
      "服务器配置、请求头/环境变量、工具 schema、参数、结果及工具访问的任何数据。"
    ),
    region: text(
      "Chosen by the user/server operator; can be local or remote.",
      "由用户/服务器运营者选择；可位于本地或远程。"
    ),
    privacyUrl: null,
    trainingAndRetention: text(
      "Determined by the server. Secrets are stored in a local JSON registry with UI redaction, not keychain encryption.",
      "由服务器决定。密钥保存在本机 JSON 注册表中，仅界面脱敏，并非钥匙串加密。"
    ),
    dpaStatus: text("User responsibility.", "由用户负责。"),
    reviewStatus: "user-configured"
  },
  {
    id: "skills-sources",
    provider: "claude-plugins.dev / skills.sh / clawhub.ai / GitHub and archive hosts",
    service: text("Skills discovery and installation", "Skills 发现与安装"),
    data: text(
      "Search queries, package identifiers, download requests, request metadata, installed code, and data accessed when a Skill runs.",
      "搜索查询、包标识符、下载请求、请求元数据、已安装代码以及 Skill 运行时访问的数据。"
    ),
    region: text(
      "Controlled by each catalog, repository, archive host, and destination reached by installed code.",
      "由各目录、仓库、压缩包托管方及已安装代码访问的目的地控制。"
    ),
    privacyUrl: null,
    trainingAndRetention: text(
      "Varies by source. Skill permission fields are declarative metadata, not a general enforcement sandbox.",
      "因来源而异。Skill 权限字段为声明性元数据，并非通用强制执行沙箱。"
    ),
    dpaStatus: text(
      "No general Lyra DPA; source-by-source review pending.",
      "不存在通用 Lyra DPA；待逐来源审阅。"
    ),
    reviewStatus: "pending"
  },
  {
    id: "github-updates",
    provider: "GitHub",
    service: text(
      "Application updates, releases, repositories, and package downloads",
      "应用更新、版本、仓库与包下载"
    ),
    data: text(
      "App version/platform, update and download requests, repository interactions, IP address, and ordinary request metadata.",
      "应用版本/平台、更新与下载请求、仓库交互、IP 地址及通常请求元数据。"
    ),
    region: text("GitHub-controlled global infrastructure.", "GitHub 控制的全球基础设施。"),
    privacyUrl: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
    trainingAndRetention: text(
      "Governed by GitHub account, repository, security, and log-retention policies.",
      "依 GitHub 账户、仓库、安全及日志保留政策。"
    ),
    dpaStatus: text(
      "No Lyra-specific DPA confirmed; release obligations for hosted source offers remain pending.",
      "尚未确认 Lyra 专属 DPA；托管源码提供相关发布义务仍待完成。"
    ),
    reviewStatus: "pending"
  },
  {
    id: "language-packs",
    provider: "Configured Lyra language-pack and catalog hosts",
    service: text("Language catalog and pack delivery", "语言目录与语言包交付"),
    data: text(
      "Requested locale/catalog/pack, app compatibility version, IP address, and ordinary request metadata.",
      "所请求语言/目录/语言包、应用兼容版本、IP 地址及通常请求元数据。"
    ),
    region: text(
      "Controlled by the configured host; final production host and region are not yet recorded.",
      "由所配置托管方控制；最终生产托管方及地区尚未登记。"
    ),
    privacyUrl: null,
    trainingAndRetention: text(
      "Host request-log retention not yet verified.",
      "托管方请求日志保留尚未核验。"
    ),
    dpaStatus: text(
      "Not confirmed; provider registration pending.",
      "尚未确认；服务商登记待完成。"
    ),
    reviewStatus: "pending"
  }
] as const;
