import type {
  DataPractice,
  LegalBlock,
  LegalDocument,
  LegalSection,
  LocalizedText
} from "./types";

const text = (en: string, zh: string): LocalizedText => ({
  "en-US": en,
  "zh-CN": zh
});

const paragraph = (en: string, zh: string): LegalBlock => ({
  kind: "paragraph",
  text: text(en, zh)
});

const notice = (en: string, zh: string): LegalBlock => ({
  kind: "notice",
  text: text(en, zh)
});

const list = (...items: readonly [string, string][]): LegalBlock => ({
  kind: "list",
  items: items.map(([en, zh]) => text(en, zh))
});

const section = (
  id: string,
  en: string,
  zh: string,
  ...blocks: readonly LegalBlock[]
): LegalSection => ({
  id,
  heading: text(en, zh),
  blocks
});

export const PRIVACY_DOCUMENT: LegalDocument = {
  id: "privacy",
  title: text("Lyra Privacy Policy", "Lyra 隐私政策"),
  description: text(
    "What the current Lyra Desktop beta keeps locally, derives, and sends to selected or integrated services.",
    "当前 Lyra Desktop 测试版在本机保存、推导以及向所选或集成服务发送哪些数据。"
  ),
  sections: [
    section(
      "draft-status-controller-and-scope",
      "Publication, controller, and scope",
      "发布状态、个人信息处理者与范围",
      notice(
        "Version 1.0.0 is effective from August 6, 2026 for Lyra Desktop 0.1.0-preview.4. The individual operator and current contact details are identified below.",
        "1.0.0 版本自 2026 年 8 月 6 日起对 Lyra Desktop 0.1.0-preview.4 生效。个人运营者及当前联系方式见下文。"
      ),
      paragraph(
        "Lyra is provided by 徐远豪 (Pete Hsu), an individual developer in mainland China trading as Lyra. For processing controlled by Lyra, this individual is the controller or personal information processor. Independent AI providers, websites, MCP servers, Skills sources, and other services may act under their own roles and policies.",
        "Lyra 由中国大陆个人开发者徐远豪（Pete Hsu）以 Lyra 名义提供。对于由 Lyra 决定的处理活动，该个人构成个人信息处理者或控制者。独立 AI 服务商、网站、MCP 服务器、Skills 来源和其他服务可能依其自身角色与政策处理数据。"
      ),
      paragraph(
        "This policy covers Lyra Desktop 0.1.0-preview.4 and the Lyra-operated website and account functions described here. It does not replace the privacy policy of a service you select or visit. The English and Simplified Chinese texts share one version and have equal authority.",
        "本政策适用于 Lyra Desktop 0.1.0-preview.4 以及本文所述由 Lyra 运营的网站和账户功能，不替代您选择或访问的服务自身隐私政策。英文与简体中文文本共享同一版本并具有同等效力。"
      )
    ),
    section(
      "local-first-not-entirely-local",
      "Local-first does not mean entirely local",
      "本地优先并非完全本地",
      paragraph(
        "Lyra keeps core workspace, session, browser, and configuration data on your device, but many requested features use networks. Signing in, selecting a cloud model, searching, loading a webpage, installing an extension, checking for updates, downloading a language pack, connecting MCP, or resolving a location can disclose data to another service.",
        "Lyra 将核心工作区、会话、浏览器和配置数据保存在您的设备上，但许多所请求功能会使用网络。登录、选择云模型、搜索、加载网页、安装扩展、检查更新、下载语言包、连接 MCP 或解析位置，都可能向其他服务披露数据。"
      ),
      paragraph(
        "Lyra does not claim that all data stays local, that the app is fully offline, or that every third party follows Lyra’s retention choices. A local model or local endpoint can reduce model-provider disclosure, but other enabled network features may still communicate externally.",
        "Lyra 不声称所有数据都留在本机、不声称应用完全离线，也不声称所有第三方都遵循 Lyra 的保留选择。本地模型或本地端点可以减少向模型服务商披露，但其他已启用网络功能仍可能对外通信。"
      )
    ),
    section(
      "data-inventory",
      "Data-processing inventory",
      "数据处理清单",
      paragraph(
        "The table below is the operative inventory for current implemented behavior. “Recipient and region” distinguishes local-only storage from network disclosure. A provider-controlled or unknown region is a release fact still requiring verification, not a promise that data remains in one country.",
        "下表是当前已实现行为的数据处理清单。“接收方与地区”区分仅本机保存与网络披露。“由服务商控制”或“未知”的地区属于仍待发布核验的事实，并不表示数据会留在某一国家。"
      )
    ),
    section(
      "agent-model-boundary",
      "Agent and model-provider boundary",
      "Agent 与模型服务商边界",
      paragraph(
        "For a cloud-model turn, Lyra builds the request from the active conversation and requested context. Depending on the task and enabled tools, that can include prompts, conversation history and summaries, attachments, selected files, images, PDFs, webpages, memory, project instructions, tool definitions, tool inputs and results, terminal or Git output, browser observations, device characteristics, screen information or screenshots, timezone, and an authorized location label. The selected provider receives and processes that request.",
        "对于云模型轮次，Lyra 会根据当前对话及所请求上下文构建请求。根据任务和已启用工具，请求可能包含提示词、对话历史与摘要、附件、所选文件、图片、PDF、网页、记忆、项目指令、工具定义、工具输入与结果、终端或 Git 输出、浏览器观察、设备特征、屏幕信息或截图、时区以及经授权的位置标签。所选服务商会接收并处理该请求。"
      ),
      paragraph(
        "Provider retention, abuse monitoring, human review, and model-training choices depend on the provider, product tier, account, endpoint, and your settings. Lyra does not make a single training or deletion promise on their behalf. Use the provider register and the provider’s current policy before sending sensitive data.",
        "服务商的保留、滥用监控、人工审阅和模型训练选择取决于服务商、产品层级、账户、端点及您的设置。Lyra 不代表第三方作出统一的训练或删除承诺。发送敏感数据前，请查看服务商登记表及该服务商的当前政策。"
      )
    ),
    section(
      "persona-and-local-identity-signals",
      "Persona and local identity signals",
      "Persona 与本机身份线索",
      paragraph(
        "Personal identity context is off by default. If you explicitly enable it in Agent settings, Lyra reads local identity clues on Agent turns from the operating-system account and host, global Git name and email, Git history and remotes, SSH public-key comments and known-host entries, npm and pip configuration, and VS Code or Cursor identity clues when present. It can infer a name, email addresses, usernames, and an approximate age from these signals. The derived Persona is inserted into the selected model’s context.",
        "个人身份上下文默认关闭。仅当您在 Agent 设置中明确开启后，Lyra 才会在 Agent 轮次读取操作系统账户与主机、Git 全局姓名和邮箱、Git 历史与远程地址、SSH 公钥注释与 known-host 条目、npm 与 pip 配置，以及存在时的 VS Code 或 Cursor 身份线索。Lyra 可据此推导姓名、邮箱地址、用户名和大致年龄，并将推导出的 Persona 插入所选模型的上下文。"
      ),
      paragraph(
        "The raw local clues are used to compute that Persona and are not all necessarily transmitted verbatim, but the resulting identity and age inferences are transmitted with the model context. Turning the setting off prevents future signal collection and Persona insertion; provider copies from earlier turns remain subject to provider retention. The individual operator reviewed and accepted the disclosed residual risk without claiming independent counsel review.",
        "原始本机线索用于计算 Persona，并不一定全部逐字传输；但最终推导出的身份和年龄信息会随模型上下文传输。关闭设置会阻止后续线索采集和 Persona 插入；此前轮次已发送给服务商的副本仍适用服务商保留规则。个人运营者已审阅并接受所披露的剩余风险，但未声称取得独立律师审阅。"
      ),
      paragraph(
        "Lyra no longer performs anonymous cloud-account enumeration from local identity signals. A local encrypted identity cache may still remain on the device after prior authenticated use; it is not a public account-discovery service.",
        "Lyra 已不再利用本机身份线索执行匿名云端账户枚举。先前登录使用后，设备上仍可能保留本机加密身份缓存；该缓存并非公开账户发现服务。"
      )
    ),
    section(
      "browser-profiles-and-credentials",
      "Browser profiles, site data, and credentials",
      "浏览器 profile、站点数据与凭证",
      paragraph(
        "Lyra supports persistent live and isolated browser profiles. They can store history, cookies, cache, permissions, downloads, and other site data locally. An isolated Agent session may borrow a live profile’s signed-in state when you enable or direct that behavior, which exposes that session and the accessible site data to Agent-driven browsing.",
        "Lyra 支持持久化的 live 与 isolated 浏览器 profile，可在本机保存历史记录、Cookie、缓存、权限、下载及其他站点数据。当您启用或指示相关行为时，隔离 Agent 会话可能借用 live profile 的登录状态，这会让 Agent 驱动的浏览访问该会话及可用站点数据。"
      ),
      paragraph(
        "Automatic password capture is off by default. If you explicitly enable it in the login manager, Lyra observes login forms in Lyra browser tabs and can capture submitted or changed usernames and passwords until you disable it. Stored credentials are encrypted locally through Electron safeStorage, whose protection depends on the operating-system account and key facilities. Lyra does not claim this is a separate hardware vault or that a compromised device cannot expose credentials.",
        "自动密码捕获默认关闭。仅当您在登录管理器中明确开启后，Lyra 才会观察 Lyra 浏览器标签页中的登录表单，并可捕获已提交或变更的用户名和密码，直至您将其关闭。保存的凭证通过 Electron safeStorage 在本机加密，其保护依赖操作系统账户和密钥设施。Lyra 不声称其属于独立硬件保险库，也不保证设备被攻破时凭证不会暴露。"
      )
    ),
    section(
      "search-web-and-location",
      "Search, webpages, and location",
      "搜索、网页与位置",
      paragraph(
        "This release does not send queries to remote suggestion providers while you type; suggestions come only from local session and browser history. Submitting a web search sends the query to the configured search service, and visiting a page discloses ordinary network data to that site. Search and page content may then enter Agent context if used in a turn.",
        "本版本不会在您输入时向远程联想服务商发送查询；联想仅来自本机会话和浏览历史。提交网页搜索会把查询发送给所配置的搜索服务，访问网页则会向该网站披露通常的网络数据。如果搜索结果或网页用于 Agent 轮次，其内容还可能进入模型上下文。"
      ),
      paragraph(
        "When you authorize precise location, this release stores the current coordinates locally for the location indicator. Public Nominatim reverse geocoding is disabled, and a coordinate-formatted local label is not included in Agent model context. A future place-name provider would require a separate implementation, disclosure, and consent review before activation.",
        "当您授权精确位置后，本版本仅在本机保存当前坐标用于位置指示。公共 Nominatim 逆地理编码已停用，坐标格式的本机标签不会加入 Agent 模型上下文。未来如启用地点名称服务商，须在启用前另行完成实现、披露和同意审阅。"
      )
    ),
    section(
      "accounts-and-authentication",
      "Accounts and authentication",
      "账户与身份认证",
      paragraph(
        "Google OAuth can provide an identifier, email, display name, and avatar to Supabase authentication and Lyra. Supabase can hold the authentication profile, session data, and Lyra profile settings such as locale, theme, and onboarding state. Session tokens and an identity cache can be protected locally using safeStorage.",
        "Google OAuth 可向 Supabase 身份认证和 Lyra 提供标识符、邮箱、显示名称及头像。Supabase 可保存认证 profile、会话数据以及语言、主题、引导状态等 Lyra profile 设置。会话令牌和身份缓存可使用 safeStorage 在本机保护。"
      ),
      paragraph(
        "Signing out ends the active session but may not erase every local identity cache or delete the cloud account. The beta provides a signed-in, confirmation-gated cloud-account deletion path backed by a server-only Supabase function. As of August 6, 2026, that production path has not completed an end-to-end release test; contact the privacy mailbox if the in-app path fails. Supabase region us-west-2 was verified on August 1, 2026. On August 2, 2026, the current DPA and official subprocessor list were verified through Supabase's authenticated organization dashboard and current legal pages.",
        "退出登录会结束当前会话，但未必清除所有本机身份缓存或删除云端账户。测试版提供需登录并二次确认的云端账户删除入口，由仅在服务端运行的 Supabase Function 执行。截至 2026 年 8 月 6 日，该生产路径尚未完成端到端发布测试；如应用内路径失败，请联系隐私邮箱。Supabase 地区已于 2026 年 8 月 1 日核验为 us-west-2；现行 DPA 与官方子处理者清单已于 2026 年 8 月 2 日通过 Supabase 已登录的组织控制台及现行法律页面核验。"
      )
    ),
    section(
      "extensions-and-integrations",
      "Extensions and integrations",
      "扩展与集成",
      paragraph(
        "MCP server headers and environment values are saved in a local JSON registry. The interface redacts their display, but that is not keychain encryption. MCP tool arguments and results travel to the configured local or remote server and can also enter model context.",
        "MCP 服务器请求头和环境变量保存在本机 JSON 注册表中。界面会对显示内容脱敏，但这不等于钥匙串加密。MCP 工具参数和结果会传给所配置的本地或远程服务器，也可能进入模型上下文。"
      ),
      paragraph(
        "Skill permission fields are currently declarative metadata, not a general enforcement sandbox. Installing or running a Skill can read or transmit data according to its code and invoked tools. Skills discovery and installation can contact catalog sources and GitHub or archive hosts.",
        "Skill 权限字段目前属于声明性元数据，并非通用强制执行沙箱。安装或运行 Skill 时，其代码和所调用工具可能读取或传输数据。Skills 发现和安装可能访问目录来源以及 GitHub 或压缩包托管方。"
      ),
      paragraph(
        "UIUX Packs are trusted code with the full Lyra Desktop API and are not sandboxed. Installed packs remain untrusted and cannot activate until you acknowledge this execution model and explicitly grant trust. A trusted pack can access whatever that API and the current user session permit. Install only reviewed code from a trusted source, and revoke trust or remove it if you no longer accept that access.",
        "UIUX Pack 是拥有完整 Lyra Desktop API 的受信任代码，并非沙箱。已安装的包默认保持不受信任，只有在您确认理解该执行模式并明确授予信任后才能启用。受信任的包可以访问该 API 和当前用户会话允许的内容。仅应安装经审查的可信代码；如不再接受其访问，应撤销信任或予以卸载。"
      )
    ),
    section(
      "first-party-analytics",
      "First-party analytics and advertising",
      "第一方分析与广告",
      paragraph(
        "The current reviewed beta does not integrate first-party behavioral analytics or advertising telemetry. This statement does not mean the app or Lyra-operated sites make no network requests: website infrastructure, selected providers, authentication, search suggestions, webpages, extension sources, updates, language packs, MCP, and location services still receive data as described.",
        "当前经核验的测试版未集成第一方行为分析或广告遥测。这并不表示应用或 Lyra 运营的网站不会发起网络请求：网站基础设施、所选服务商、身份认证、搜索建议、网页、扩展来源、更新、语言包、MCP 和位置服务仍会按本文所述接收数据。"
      ),
      paragraph(
        "The Lyra website and documentation use Cloudflare for hosting and edge delivery. Cloudflare can process request and security logs, while observability for the website redirect Worker can generate invocation, error, and diagnostic logs. Documentation pages and matching website static assets do not invoke an application Worker. These operational records are not described here as first-party behavioral analytics, but they can contain personal information and remain subject to the data inventory, provider register, plan settings, and Cloudflare’s policies.",
        "Lyra 官网和文档使用 Cloudflare 托管及边缘分发。Cloudflare 可能处理请求和安全日志，官网重定向 Worker 的可观测性则可能生成调用、错误及诊断日志。文档页面及匹配的官网静态资源不会调用应用 Worker。这些运行记录在本文中不称为第一方行为分析，但其中可能包含个人信息，并受数据处理清单、服务商登记表、套餐设置及 Cloudflare 政策约束。"
      )
    ),
    section(
      "retention-and-deletion",
      "Retention and deletion",
      "保留与删除",
      paragraph(
        "Local data generally remains until you delete it through an available Lyra control, clear the relevant browser profile or workspace, remove the associated files, or reset application data. Different stores are independent: clearing a conversation does not necessarily clear browser data, credentials, downloads, logs, MCP configuration, extensions, or backups.",
        "本机数据通常会保留，直到您通过现有 Lyra 控制删除、清理相关浏览器 profile 或工作区、移除对应文件或重置应用数据。不同存储彼此独立：删除对话不一定会清除浏览器数据、凭证、下载、日志、MCP 配置、扩展或备份。"
      ),
      paragraph(
        "Cloud and third-party retention is controlled by the relevant provider, account tier, endpoint operator, website, server, or package host. Removing local data does not automatically remove remote copies, provider logs, prior requests, website records, synced data, or backups.",
        "云端及第三方保留由相关服务商、账户层级、端点运营者、网站、服务器或包托管方控制。删除本机数据不会自动删除远程副本、服务商日志、既往请求、网站记录、同步数据或备份。"
      )
    ),
    section(
      "rights-and-choices",
      "Your rights and choices",
      "您的权利与选择",
      paragraph(
        "Depending on applicable law, you may have rights to know, access, correct, copy, delete, restrict, object to, or withdraw consent for personal information, and to complain to a regulator. You can also choose a local model, avoid sign-in, decline location, use an isolated browser profile, limit tool permissions, avoid untrusted extensions, and remove local data where controls exist.",
        "根据适用法律，您可能享有知情、访问、更正、复制、删除、限制处理、提出异议、撤回同意以及向监管机构投诉等权利。您也可以选择本地模型、不登录、拒绝位置、使用隔离浏览器 profile、限制工具权限、避免不受信任的扩展，并在存在控制时删除本机数据。"
      ),
      notice(
        "You may send a privacy request to the personal privacy mailbox shown below. It is operated by the individual developer, not a dedicated privacy desk, and delivery or timely review through any single channel is not guaranteed. If you receive no response within a reasonable time, use another personal channel listed in the official site footer or resend the email. Do not include passwords, API keys, or unnecessary sensitive information. As of August 6, 2026, the cloud-deletion and rights-request process has not completed a production end-to-end test.",
        "您可以通过下方列明的个人隐私邮箱提交请求。该邮箱由个人开发者本人维护，并非专职隐私事务团队；任何单一渠道均不保证送达或被及时查看。如在合理时间内未收到回复，请改用官网底部列出的其他个人渠道或重新发送邮件。请勿在请求中包含密码、API 密钥或非必要敏感信息。截至 2026 年 8 月 6 日，云端删除及权利请求流程尚未完成生产端到端测试。"
      )
    ),
    section(
      "security",
      "Security",
      "安全措施",
      paragraph(
        "Lyra uses measures such as operating-system-bound safeStorage for certain local secrets, redaction in selected interfaces, application permissions, and transport security supplied by configured HTTPS services. Other values, including MCP headers and environment entries, can remain in local plaintext files. No security measure is absolute.",
        "Lyra 对部分本机密钥采用依赖操作系统的 safeStorage，并使用特定界面脱敏、应用权限以及所配置 HTTPS 服务提供的传输安全。其他值（包括 MCP 请求头和环境变量）可能仍以本机明文文件保存。任何安全措施都不是绝对的。"
      ),
      paragraph(
        "You should secure the operating-system account, disk, backups, API keys, browser sessions, remote repositories, and extensions; keep Lyra and the OS updated; and review high-impact Agent actions.",
        "您应保护操作系统账户、磁盘、备份、API 密钥、浏览器会话、远程仓库和扩展，及时更新 Lyra 与操作系统，并复核高影响 Agent 操作。"
      )
    ),
    section(
      "international-processing",
      "International processing",
      "跨境处理",
      paragraph(
        "Lyra is operated from mainland China. This Preview is directed to the United States, Canada, Japan, and Singapore and is not actively marketed to mainland China, the EEA, or the United Kingdom. The website and documentation use Cloudflare’s global edge infrastructure. The Supabase authentication/profile project uses us-west-2; its current DPA and subprocessor register were verified. Google OAuth uses Google-controlled global infrastructure. A cloud model, MCP server, Skill source, website, or custom endpoint selected by you can process data in its own region or globally.",
        "Lyra 从中国大陆运营。本 Preview 定向面向美国、加拿大、日本和新加坡，不主动面向中国大陆、EEA 或英国营销。官网与文档使用 Cloudflare 全球边缘基础设施。Supabase 身份认证/profile 项目使用 us-west-2，且已核验其现行 DPA 与子处理者登记；Google OAuth 使用由 Google 控制的全球基础设施。您选择的云端模型、MCP 服务器、Skill 来源、网站或自定义端点可能在其自身地区或全球处理数据。"
      ),
      paragraph(
        "For Lyra-controlled processors, contractual terms, published provider safeguards, data minimization, transport security, and the disclosures in this policy are the recorded safeguards. Canada requires accountability and transparency for foreign processing; Japan and Singapore can require consent or comparable/continuing protection depending on the route. User-selected providers remain subject to the terms and transfer settings of the selected account. Lyra does not claim universal adequacy, a single mechanism for every destination, or a data-residency guarantee.",
        "对于 Lyra 控制的处理服务商，已记录的保障包括合同条款、服务商公开保障、数据最小化、传输安全及本政策披露。加拿大要求对境外处理保持问责与透明；日本和新加坡可能依具体路径要求同意或可比、持续的保护。用户选择的服务商仍适用所选账户的条款与跨境设置。Lyra 不声称普遍充分性、覆盖所有目的地的单一机制或数据驻留保证。"
      )
    ),
    section(
      "age",
      "Age",
      "年龄",
      paragraph(
        "Lyra is intended only for people aged 18 or older. We do not knowingly offer the beta to children. If we learn that data was processed from someone under 18 contrary to this rule, a verified contact and deletion process will be needed to evaluate and address it.",
        "Lyra 仅面向年满 18 周岁的人士。我们不会在知情情况下向未成年人提供测试版。如发现违反本规则处理了未满 18 周岁人士的数据，需要通过经核验的联系与删除流程进行评估和处理。"
      )
    ),
    section(
      "policy-changes-and-contact",
      "Policy changes and contact",
      "政策变更与联系",
      paragraph(
        "Material changes receive a new version and effective date and appear in Legal History. If a new purpose legally requires consent, a notice or continued use will not replace that consent.",
        "重大变更将采用新版本和生效日期，并出现在“法律版本历史”中。如新目的依法需要同意，通知或继续使用不能替代该同意。"
      ),
      notice(
        "The privacy and support functions currently share the operator’s published personal mailbox. The four alternatives in the official site footer are also personal channels and may be used if email or another channel is unavailable. The operator confirmed that the published physical address is the complete community address used for parcel delivery. The response workflow and final monitoring verification remain incomplete; do not mark this policy effective until every release gate is complete.",
        "隐私与支持目前共用运营者已公布的个人邮箱。官网底部的四个备用入口同样属于个人联系方式；如邮箱或某一渠道不可用，可改用其他渠道。运营者已确认所公布物理地址即实际使用的完整小区快递地址。响应流程及最终监控核验仍未完成；所有发布门禁完成前不得将本政策标记为生效。"
      )
    )
  ]
};

const practice = (
  id: string,
  category: readonly [string, string],
  fieldsAndSource: readonly [string, string],
  purpose: readonly [string, string],
  recipientAndRegion: readonly [string, string],
  retention: readonly [string, string],
  deletion: readonly [string, string]
): DataPractice => ({
  id,
  category: text(...category),
  fieldsAndSource: text(...fieldsAndSource),
  purpose: text(...purpose),
  legalBasis: legalBasisFor(id),
  recipientAndRegion: text(...recipientAndRegion),
  retention: text(...retention),
  deletion: text(...deletion)
});

const legalBasisFor = (id: string) => {
  const explicitConsent = text(
    "Explicit, off-by-default user choice. Where applicable law requires separate consent for sensitive information or an international transfer, that separate consent is also required; the feature must remain off if valid consent is unavailable.",
    "基于用户明确且默认关闭的选择。适用法律要求对敏感个人信息或跨境提供取得单独同意时，还必须另行取得该同意；无法取得有效同意时，该功能必须保持关闭。"
  );
  const requestedService = text(
    "Necessary to provide the feature or action requested by the user, and legitimate interests in security, reliability, and abuse prevention where that basis is recognized. Consent is used instead when applicable law requires it.",
    "为提供用户所请求的功能或操作所必需；在适用法律认可时，也基于安全、可靠性及防止滥用的合法利益。适用法律要求同意时则改以同意为基础。"
  );

  switch (id) {
    case "persona-signals":
    case "credentials":
    case "location":
    case "uiux":
      return explicitConsent;
    case "model-requests":
      return text(
        "Necessary to perform the user-requested model action. Explicit consent is additionally required where the assembled context contains sensitive personal information or applicable law requires separate consent for the selected cross-border recipient.",
        "为执行用户请求的模型操作所必需。组装的上下文含敏感个人信息，或适用法律要求就所选跨境接收方取得单独同意时，还须另行取得明确同意。"
      );
    case "account-data":
      return text(
        "Necessary to create and operate the account and session requested by the user; Google OAuth is initiated by an affirmative user action. Consent or another locally required basis applies to optional profile fields.",
        "为创建并运行用户请求的账户和会话所必需；Google OAuth 由用户主动发起。可选 profile 字段依同意或当地法律要求的其他依据处理。"
      );
    case "website-cloudflare-infrastructure":
    case "local-workspace-data":
    case "browser-data":
    case "files-terminal-downloads":
    case "logs-and-extension-data":
    case "search-data":
    case "mcp-and-skills":
    case "updates-and-language-packs":
      return requestedService;
    default:
      throw new Error(`Missing legal-basis disclosure for data practice ${id}`);
  }
};

export const DATA_PRACTICES: readonly DataPractice[] = [
  practice(
    "website-cloudflare-infrastructure",
    [
      "Website/documentation requests and infrastructure logs",
      "官网/文档请求与基础设施日志"
    ],
    [
      "From visitors and network requests: IP address; hostname, URL path and query; HTTP headers such as user agent, referrer, locale and any cookies sent; network, TLS, routing and security metadata. The sites can store theme choices locally under lyra-site-theme and lyra.docs.theme; the documentation language is represented in the URL path or locale query rather than a Lyra-set language cookie. The website redirect Worker can also generate invocation, error and diagnostic logs.",
      "来自访问者及网络请求：IP 地址；主机名、URL 路径与查询参数；User-Agent、来源页面、区域语言及请求所携带 Cookie 等 HTTP 请求头；网络、TLS、路由与安全元数据。网站可在本机通过 lyra-site-theme 与 lyra.docs.theme 保存主题选择；文档语言体现在 URL 路径或 locale 查询参数中，而不是由 Lyra 设置的语言 Cookie。官网重定向 Worker 还可能生成调用、错误及诊断日志。"
    ],
    [
      "Serve and cache pages and assets, remember the selected theme, route to the requested documentation language, terminate secure connections, protect against abuse, maintain availability, and diagnose failures.",
      "提供并缓存页面与资源、记住所选主题、路由至请求的文档语言、终止安全连接、防范滥用、维持可用性并诊断故障。"
    ],
    [
      "Cloudflare and the Lyra operator. Processing uses Cloudflare-controlled global edge infrastructure; exact log-processing and storage locations and applicable subprocessors have not been verified for release.",
      "接收方为 Cloudflare 与 Lyra 运营者。处理使用 Cloudflare 控制的全球边缘基础设施；确切日志处理与存储地点及适用子处理者尚未完成发布核验。"
    ],
    [
      "Theme values remain in browser local storage until changed or cleared. Workers observability is enabled for the website redirect Worker, with invocation head sampling currently configured at 10%; documentation pages and matching website static assets do not invoke an application Worker. Invocation, error, security and diagnostic records are retained according to the active Cloudflare plan and settings; security or other provider logs can use separate controls, and final export, account-plan and retention settings have not been verified for release.",
      "主题值会保留在浏览器本地存储中，直至被更改或清除。官网重定向 Worker 已启用 Workers 可观测性，调用头部采样率目前配置为 10%；文档页面及匹配的官网静态资源不会调用应用 Worker。调用、错误、安全及诊断记录依有效 Cloudflare 套餐与设置保留；安全或其他服务商日志可能使用独立控制，最终导出、账户套餐及保留设置尚未完成发布核验。"
    ],
    [
      "Delete theme preferences by clearing the relevant site’s local storage or site data; choosing a theme later can create them again. Closing the page does not delete provider logs. Records ordinarily expire under the configured provider retention; there is no visitor self-service control to delete an individual request log. Privacy requests may be sent through Lyra’s published personal contact channels, and Cloudflare’s own rights mechanisms may apply. Local browser cache and other site data must be cleared separately.",
      "可通过清除相应网站的本地存储或站点数据删除主题偏好；以后再次选择主题时可能重新创建。关闭页面不会删除服务商日志。记录通常依所配置的服务商保留期限到期；目前没有供访问者自助删除单条请求日志的控制。隐私请求可通过 Lyra 已公布的个人联系方式提交，Cloudflare 自身的权利请求机制也可能适用。本地浏览器缓存及其他站点数据需另行清理。"
    ]
  ),
  practice(
    "local-workspace-data",
    ["Sessions, memory, projects, and workspaces", "会话、记忆、项目与工作区"],
    [
      "Prompts, messages, summaries, plans, checkpoints, project paths and instructions, remembered facts, tabs, layout, preferences, and the locally recorded legal-document versions and acceptance timestamp created through use.",
      "使用过程中产生的提示词、消息、摘要、计划、checkpoint、项目路径与指令、记忆事实、标签、布局、偏好，以及本机记录的法律文档版本和接受时间。"
    ],
    [
      "Restore work, build Agent context, organize projects, and support checkpoint or rollback workflows.",
      "恢复工作、构建 Agent 上下文、组织项目并支持 checkpoint 或 rollback 工作流。"
    ],
    [
      "Stored on the device. Selected content is sent to the chosen model or invoked tool when needed for a turn.",
      "保存在设备上；轮次需要时，所选内容会发送给选定模型或所调用工具。"
    ],
    [
      "Until deleted, workspace data is removed, or application data is reset; independent filesystem or backup copies may remain.",
      "保留至主动删除、移除工作区数据或重置应用数据；独立文件系统或备份副本可能继续存在。"
    ],
    [
      "Delete through available session, memory, project, and local-data controls, and separately remove filesystem backups.",
      "通过现有会话、记忆、项目和本机数据控制删除，并另行移除文件系统备份。"
    ]
  ),
  practice(
    "browser-data",
    ["Browser profiles, history, and site data", "浏览器 profile、历史与站点数据"],
    [
      "Live and isolated profile cookies, cache, history, permissions, downloads, session state, and page observations.",
      "live 与 isolated profile 的 Cookie、缓存、历史、权限、下载、会话状态和网页观察。"
    ],
    [
      "Browse, preserve or isolate sessions, automate pages, and supply page context to tools or models.",
      "浏览、保留或隔离会话、自动操作网页，并向工具或模型提供网页上下文。"
    ],
    [
      "Stored locally; websites receive ordinary network requests. Borrowing a live profile exposes its signed-in state to the Agent session.",
      "保存在本机；网站会收到通常的网络请求。借用 live profile 会将其登录状态暴露给 Agent 会话。"
    ],
    [
      "Persists with the profile until cleared or the profile/application data is removed.",
      "随 profile 保留，直至清理或移除该 profile/应用数据。"
    ],
    [
      "Clear the relevant profile and site data; remove downloads and backups separately.",
      "清理相关 profile 与站点数据；下载和备份需另行移除。"
    ]
  ),
  practice(
    "files-terminal-downloads",
    ["Files, terminal, Git, downloads, and tool results", "文件、终端、Git、下载与工具结果"],
    [
      "Opened files and attachments, command text and output, repository status/diffs, downloaded files, tool inputs, results, and errors.",
      "打开的文件与附件、命令文本及输出、仓库状态/差异、下载文件、工具输入、结果和错误。"
    ],
    [
      "Perform user-requested work, display results, maintain context, diagnose failures, and support rollback.",
      "执行用户请求、展示结果、维持上下文、诊断失败并支持回滚。"
    ],
    [
      "Stored on the device or workspace; sent to the selected model, remote host, website, Git service, or tool target when required by the action.",
      "保存在设备或工作区；操作需要时发送给所选模型、远程主机、网站、Git 服务或工具目标。"
    ],
    [
      "Workspace and history retention varies by store; remote recipients retain data under their own rules.",
      "工作区及历史保留时间因存储而异；远程接收方按其自身规则保留。"
    ],
    [
      "Delete local files, sessions, terminal history, downloads, and tool records separately; use recipient controls for remote copies.",
      "分别删除本机文件、会话、终端历史、下载和工具记录；远程副本需使用接收方控制。"
    ]
  ),
  practice(
    "logs-and-extension-data",
    ["Logs, settings, and extension data", "日志、设置与扩展数据"],
    [
      "Application and error logs, preferences, Skill and MCP configuration, installed UIUX or capability state, and extension-created files.",
      "应用与错误日志、偏好、Skill 与 MCP 配置、已安装 UIUX 或能力状态以及扩展创建的文件。"
    ],
    [
      "Operate, troubleshoot, configure, and extend Lyra.",
      "运行、排障、配置和扩展 Lyra。"
    ],
    [
      "Primarily local; an extension or support disclosure can send data to its author, endpoint, or a person you choose.",
      "主要在本机；扩展或您主动提供支持材料时可能发送给作者、端点或您选择的人员。"
    ],
    [
      "Until cleared, uninstalled, or application data is reset. Some extension files can outlive uninstallation.",
      "保留至清理、卸载或重置应用数据；部分扩展文件可能在卸载后仍存在。"
    ],
    [
      "Clear logs/settings, uninstall extensions, and inspect or remove their local directories separately.",
      "清理日志/设置、卸载扩展，并另行检查或移除其本机目录。"
    ]
  ),
  practice(
    "persona-signals",
    ["Local identity signals and derived Persona", "本机身份线索与推导 Persona"],
    [
      "OS account/host details; Git name, email, history and remotes; SSH public-key comments and known hosts; npm, pip, VS Code, and Cursor identity clues. Lyra derives name, emails, usernames, and approximate age.",
      "操作系统账户/主机信息；Git 姓名、邮箱、历史与远程地址；SSH 公钥注释与 known hosts；npm、pip、VS Code 和 Cursor 身份线索。Lyra 据此推导姓名、邮箱、用户名及大致年龄。"
    ],
    [
      "Personalize the Agent Persona and model context for the current turn.",
      "为当前轮次个性化 Agent Persona 和模型上下文。"
    ],
    [
      "Off by default. After explicit opt-in, signals are read locally on Agent turns. The derived Persona is sent to the selected model; raw clues are not necessarily sent verbatim.",
      "默认关闭。明确选择开启后，在 Agent 轮次于本机读取线索；推导出的 Persona 发送给所选模型，原始线索不一定逐字发送。"
    ],
    [
      "Local inputs remain in their source systems; model-side retention follows provider policy. A local encrypted identity cache can persist.",
      "本机输入保留在其来源系统；模型侧保留遵循服务商政策。本机加密身份缓存可能持续存在。"
    ],
    [
      "Edit/remove source identity data and local Lyra data where possible; provider-side requests require provider controls. No anonymous account enumeration occurs.",
      "在可能时编辑/移除来源身份信息和 Lyra 本机数据；服务商侧请求需使用其控制。不会执行匿名账户枚举。"
    ]
  ),
  practice(
    "model-requests",
    ["Prompts and Agent/model context", "提示词与 Agent/模型上下文"],
    [
      "Prompts, messages, attachments, files, images/PDFs, webpages, memories, tool definitions/results, device and screen context, timezone, and authorized location labels as relevant.",
      "与任务相关的提示词、消息、附件、文件、图片/PDF、网页、记忆、工具定义/结果、设备与屏幕上下文、时区和已授权位置标签。"
    ],
    [
      "Generate responses, plans, code, tool calls, summaries, and other requested output.",
      "生成响应、计划、代码、工具调用、摘要及其他所请求输出。"
    ],
    [
      "The user-selected cloud provider or custom endpoint in its provider-controlled region; local endpoints remain local only if their own configuration does.",
      "发送至用户选择的云服务商或自定义端点及其控制地区；本地端点仅在其自身配置确实本地时保持本地。"
    ],
    [
      "Local conversation history until deletion; provider retention and training depend on provider, tier, account, endpoint, and settings.",
      "本机对话历史保留至删除；服务商保留与训练取决于服务商、层级、账户、端点及设置。"
    ],
    [
      "Delete local history and use provider/endpoint controls for remote requests and logs.",
      "删除本机历史，并使用服务商/端点控制处理远程请求与日志。"
    ]
  ),
  practice(
    "account-data",
    ["Google OAuth, Supabase profile, and sessions", "Google OAuth、Supabase profile 与会话"],
    [
      "Google subject identifier, email, name, avatar, Supabase user/session identifiers, locale, theme, onboarding state, and local identity cache.",
      "Google 主体标识符、邮箱、姓名、头像、Supabase 用户/会话标识符、语言、主题、引导状态和本机身份缓存。"
    ],
    [
      "Authenticate, display the account, sync limited profile settings, and maintain sessions.",
      "身份认证、展示账户、同步有限 profile 设置并维持会话。"
    ],
    [
      "Google, Supabase, and Lyra; the Supabase project uses region identifier us-west-2, verified on 2026-08-01.",
      "Google、Supabase 和 Lyra；Supabase 项目使用地区标识符 us-west-2，已于 2026-08-01 核验。"
    ],
    [
      "Supabase/provider policy and account configuration; session tokens and identity cache persist locally until cleared or replaced.",
      "依 Supabase/服务商政策和账户配置；会话令牌与身份缓存会在本机保留至清理或替换。"
    ],
    [
      "Sign out for the active session, use the signed-in Delete cloud account action for the Supabase account/profile, and clear local data separately. End-to-end production deletion evidence is still pending.",
      "退出当前会话；使用登录状态下的“删除云端账户”操作删除 Supabase 账户/profile；另行清理本机数据。生产端到端删除证据仍待完成。"
    ]
  ),
  practice(
    "credentials",
    ["Form credentials and provider keys", "表单凭证与服务商密钥"],
    [
      "After explicit opt-in, login-form usernames/passwords observed on submit/change; model API keys; browser sessions; MCP headers and environment values.",
      "明确选择开启后，在表单提交/变更时观察的登录用户名/密码；模型 API 密钥；浏览器会话；MCP 请求头与环境变量。"
    ],
    [
      "Fill logins, authenticate model and integration requests, and preserve configured access.",
      "填写登录、认证模型与集成请求并保留已配置访问。"
    ],
    [
      "Credentials are local until used with the target service. Form credentials and some secrets use safeStorage; MCP headers/env remain in a local JSON registry with UI redaction only.",
      "凭证在用于目标服务前保存在本机。表单凭证和部分密钥使用 safeStorage；MCP 请求头/env 保存在本机 JSON 注册表中，仅界面脱敏。"
    ],
    [
      "Until removed, profile/application data is reset, or the target revokes them.",
      "保留至移除、重置 profile/应用数据或目标服务撤销。"
    ],
    [
      "Remove saved credentials/configuration locally and revoke or rotate them at the target service.",
      "在本机移除已保存凭证/配置，并在目标服务撤销或轮换。"
    ]
  ),
  practice(
    "search-data",
    ["Search suggestions, web search, and webpages", "搜索建议、网页搜索与网页"],
    [
      "Locally matched typed text, submitted searches, destination URLs, ordinary request metadata, and retrieved content.",
      "仅在本机匹配的输入文本、已提交搜索、目标 URL、通常请求元数据及检索内容。"
    ],
    [
      "Suggest, search, browse, summarize, and use web evidence.",
      "提供建议、搜索、浏览、摘要并使用网页证据。"
    ],
    [
      "Local history while typing; after submission, the configured web-search service and visited websites process the request in their provider-controlled regions. Google Suggest and Wikipedia integrations are disabled in this release.",
      "输入期间仅使用本机历史；提交后由所配置网页搜索服务及访问的网站在其控制地区处理。本版本已停用 Google Suggest 与 Wikipedia 集成。"
    ],
    [
      "Local history/profile retention plus each recipient’s policy.",
      "本机历史/profile 保留加各接收方政策。"
    ],
    [
      "Clear local search/browser data and use recipient controls where available.",
      "清理本机搜索/浏览器数据，并在可用时使用接收方控制。"
    ]
  ),
  practice(
    "location",
    ["Authorized precise location", "经授权的精确位置"],
    [
      "Exact latitude, longitude, locally formatted coordinate label, authorization state, and timestamp/context.",
      "准确纬度、经度、本机格式化的坐标标签、授权状态和时间/上下文。"
    ],
    [
      "Display the current local position indicator.",
      "展示当前本机位置指示。"
    ],
    [
      "Local device only in this release. Public Nominatim calls are disabled and coordinate labels are excluded from Agent model context.",
      "本版本仅限本机。公共 Nominatim 请求已停用，坐标标签不会加入 Agent 模型上下文。"
    ],
    [
      "Stored locally until revoked, replaced, or local data is cleared.",
      "在本机保留至撤回授权、被新结果替换或清理本机数据。"
    ],
    [
      "Decline or revoke location permission and clear the local location state.",
      "拒绝或撤回位置权限，并清理本机位置状态。"
    ]
  ),
  practice(
    "mcp-and-skills",
    ["MCP and Skills", "MCP 与 Skills"],
    [
      "MCP configuration, headers/env, tool schemas, arguments/results; Skill metadata, code, downloads, declared permissions, and invoked data.",
      "MCP 配置、请求头/env、工具 schema、参数/结果；Skill 元数据、代码、下载、声明权限及调用数据。"
    ],
    [
      "Discover, configure, install, and run external tools and workflows.",
      "发现、配置、安装并运行外部工具和工作流。"
    ],
    [
      "Configured MCP servers; Skills catalogs such as claude-plugins.dev, skills.sh and clawhub.ai; GitHub/archive hosts; destinations reached by installed code.",
      "所配置 MCP 服务器；claude-plugins.dev、skills.sh、clawhub.ai 等 Skills 目录；GitHub/压缩包托管方；已安装代码访问的目的地。"
    ],
    [
      "Local registry/install data until removed; remote retention follows each source/server. Permission metadata is not a general sandbox.",
      "本机注册表/安装数据保留至移除；远程保留依各来源/服务器。权限元数据不是通用沙箱。"
    ],
    [
      "Remove MCP entries/Skills and their files; request remote deletion from the server/source if applicable.",
      "移除 MCP 条目/Skills 及其文件；适用时向服务器/来源请求远程删除。"
    ]
  ),
  practice(
    "uiux",
    ["UIUX Packs and software capabilities", "UIUX Pack 与软件能力"],
    [
      "Pack code, manifest, state, and any data accessed through the full Lyra Desktop API or capability calls.",
      "Pack 代码、manifest、状态以及通过完整 Lyra Desktop API 或能力调用访问的数据。"
    ],
    [
      "Customize the interface and add Preview capabilities.",
      "自定义界面并增加 Preview 能力。"
    ],
    [
      "Trusted installed code and every endpoint it contacts. UIUX is not sandboxed.",
      "已安装的受信任代码及其访问的所有端点。UIUX 并非沙箱。"
    ],
    [
      "Until uninstalled or its local state is removed; remote destinations follow their own rules.",
      "保留至卸载或移除其本机状态；远程目的地依自身规则。"
    ],
    [
      "Uninstall the pack/capability and separately remove residual local or remote data.",
      "卸载 pack/能力，并另行移除残留的本机或远程数据。"
    ]
  ),
  practice(
    "updates-and-language-packs",
    ["Updates, language packs, and package sources", "更新、语言包与包来源"],
    [
      "App version/platform, update request metadata, release/download selection, language catalog and pack requests.",
      "应用版本/平台、更新请求元数据、版本/下载选择、语言目录及语言包请求。"
    ],
    [
      "Check for and download Lyra releases and language resources.",
      "检查并下载 Lyra 版本与语言资源。"
    ],
    [
      "GitHub release infrastructure and configured language-pack/catalog hosts in their provider-controlled regions.",
      "GitHub 发布基础设施及所配置语言包/目录托管方，由各方控制处理地区。"
    ],
    [
      "Local update/pack state until replaced or removed; host request logs follow host policy.",
      "本机更新/语言包状态保留至替换或移除；托管方请求日志依其政策。"
    ],
    [
      "Remove local packs/cache; use host rights mechanisms for remote logs where applicable.",
      "移除本机语言包/缓存；适用时使用托管方权利机制处理远程日志。"
    ]
  )
] as const;
