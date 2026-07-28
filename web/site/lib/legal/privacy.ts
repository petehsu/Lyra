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
      "Draft status, controller, and scope",
      "草案状态、个人信息处理者与范围",
      notice(
        "This policy is a publication-pending draft and is not effective. Contact details, provider assurances, international-transfer analysis, and legal approval remain incomplete.",
        "本政策为待发布草案，尚未生效。联系信息、服务商保障、跨境传输分析和律师批准仍未完成。"
      ),
      paragraph(
        "Lyra is provided by 徐远豪 (Pete Hsu), an individual developer in mainland China trading as Lyra. For processing controlled by Lyra, this individual is the controller or personal information processor. Independent AI providers, websites, MCP servers, Skills sources, and other services may act under their own roles and policies.",
        "Lyra 由中国大陆个人开发者徐远豪（Pete Hsu）以 Lyra 名义提供。对于由 Lyra 决定的处理活动，该个人构成个人信息处理者或控制者。独立 AI 服务商、网站、MCP 服务器、Skills 来源和其他服务可能依其自身角色与政策处理数据。"
      ),
      paragraph(
        "This policy covers Lyra Desktop 0.1.x beta and the Lyra-operated website and account functions described here. It does not replace the privacy policy of a service you select or visit. The English and Simplified Chinese texts share one version and have equal authority.",
        "本政策适用于 Lyra Desktop 0.1.x 测试版以及本文所述由 Lyra 运营的网站和账户功能，不替代您选择或访问的服务自身隐私政策。英文与简体中文文本共享同一版本并具有同等效力。"
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
        "On each current Agent turn, Lyra reads local identity clues from the operating system account and host, global Git name and email, Git history and remotes, SSH public-key comments and known-host entries, npm and pip configuration, and VS Code or Cursor identity clues when present. It can infer a name, email addresses, usernames, and an approximate age from these signals. The derived Persona is inserted into the selected model’s context.",
        "在当前每次 Agent 轮次中，Lyra 会读取操作系统账户与主机、Git 全局姓名和邮箱、Git 历史与远程地址、SSH 公钥注释与 known-host 条目、npm 与 pip 配置，以及存在时的 VS Code 或 Cursor 身份线索。Lyra 可据此推导姓名、邮箱地址、用户名和大致年龄，并将推导出的 Persona 插入所选模型的上下文。"
      ),
      paragraph(
        "The raw local clues are used to compute that Persona and are not all necessarily transmitted verbatim, but the resulting identity and age inferences are transmitted with the model context. This behavior currently occurs per turn and is not described as consent-gated. It requires explicit legal review before publication.",
        "原始本机线索用于计算 Persona，并不一定全部逐字传输；但最终推导出的身份和年龄信息会随模型上下文传输。该行为目前按轮次执行，不能描述为已受同意开关控制，发布前必须接受明确的法律审阅。"
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
        "The login manager currently observes login forms and can automatically capture submitted or changed usernames and passwords. Stored credentials are encrypted locally through Electron safeStorage, whose protection depends on the operating-system account and key facilities. Lyra does not claim this is a separate hardware vault or that a compromised device cannot expose credentials.",
        "登录管理器目前会观察登录表单，并可自动捕获已提交或变更的用户名和密码。保存的凭证通过 Electron safeStorage 在本机加密，其保护依赖操作系统账户和密钥设施。Lyra 不声称其属于独立硬件保险库，也不保证设备被攻破时凭证不会暴露。"
      )
    ),
    section(
      "search-web-and-location",
      "Search, webpages, and location",
      "搜索、网页与位置",
      paragraph(
        "As you type in search surfaces, a short debounce can send the typed query to Google Suggest and Wikipedia to obtain suggestions. Submitting a web search sends the query to the configured search service, and visiting a page discloses ordinary network data to that site. Search and page content may then enter Agent context if used in a turn.",
        "当您在搜索界面输入时，短暂防抖后可能将已输入查询发送至 Google Suggest 和 Wikipedia 以获取建议。提交网页搜索会把查询发送给所配置的搜索服务，访问网页则会向该网站披露通常的网络数据。如果搜索结果或网页用于 Agent 轮次，其内容还可能进入模型上下文。"
      ),
      paragraph(
        "When you authorize precise location, Lyra can send exact latitude and longitude plus locale information to the public Nominatim service for reverse geocoding, then use the resulting place label in the product or model context. The public Nominatim usage policy asks clients not to submit personal or confidential data. Exact-coordinate use therefore remains a specific publication risk requiring review.",
        "当您授权精确位置后，Lyra 可将准确经纬度及区域语言信息发送给公共 Nominatim 服务进行逆地理编码，再在产品或模型上下文中使用所得地点标签。公共 Nominatim 使用政策要求客户端不要提交个人或机密数据，因此发送精确坐标仍是必须专项审阅的发布风险。"
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
        "Signing out ends the active session but may not erase every local identity cache or delete the cloud account. A personal mailbox is now published for privacy requests, but the current beta still has no verified self-service cloud-account deletion flow or end-to-end rights-request process. Those capabilities and the Supabase project region, DPA, and subprocessors remain release blockers.",
        "退出登录会结束当前会话，但未必清除所有本机身份缓存或删除云端账户。目前已公布一个用于隐私请求的个人邮箱，但当前测试版仍没有已核验的自助云端账户删除流程或端到端权利请求流程。这些能力以及 Supabase 项目地区、DPA 和子处理者仍属于发布阻断项。"
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
        "UIUX Packs are trusted code with the full Lyra Desktop API and are not sandboxed. A pack can access whatever that API and the current user session permit. Install only reviewed code from a trusted source, and remove it if you no longer accept that access.",
        "UIUX Pack 是拥有完整 Lyra Desktop API 的受信任代码，并非沙箱。它可以访问该 API 和当前用户会话允许的内容。仅应安装经审查的可信代码；如不再接受其访问，应予卸载。"
      )
    ),
    section(
      "first-party-analytics",
      "First-party analytics and advertising",
      "第一方分析与广告",
      paragraph(
        "The current reviewed beta does not integrate first-party behavioral analytics or advertising telemetry. This statement does not mean the app makes no network requests: selected providers, authentication, search suggestions, webpages, extension sources, updates, language packs, MCP, and location services still receive data as described.",
        "当前经核验的测试版未集成第一方行为分析或广告遥测。这并不表示应用不会发起网络请求：所选服务商、身份认证、搜索建议、网页、扩展来源、更新、语言包、MCP 和位置服务仍会按本文所述接收数据。"
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
        "You may send a privacy request to the personal privacy mailbox shown below. It is operated by the individual developer, not a dedicated privacy desk, and delivery or timely review through any single channel is not guaranteed. If you receive no response within a reasonable time, use another personal channel listed in the official site footer or resend the email. Do not include passwords, API keys, or unnecessary sensitive information. The cloud-deletion and end-to-end rights-request workflow is not yet verified and remains a release blocker.",
        "您可以通过下方列明的个人隐私邮箱提交请求。该邮箱由个人开发者本人维护，并非专职隐私事务团队；任何单一渠道均不保证送达或被及时查看。如在合理时间内未收到回复，请改用官网底部列出的其他个人渠道或重新发送邮件。请勿在请求中包含密码、API 密钥或非必要敏感信息。云端删除及端到端权利请求流程尚未核验，仍属于发布阻断项。"
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
        "Lyra is operated from mainland China and is intended primarily for overseas distribution. A service you choose may process data in its own region or globally. The Supabase project region has not been confirmed, and provider regions, subprocessors, DPAs, EEA/UK representation, and any required transfer safeguards remain under release review.",
        "Lyra 从中国大陆运营，并以海外发行优先。您选择的服务可能在其自身地区或全球处理数据。Supabase 项目地区尚未确认，服务商地区、子处理者、DPA、EEA/英国代表以及任何所需跨境保障仍处于发布审阅中。"
      ),
      paragraph(
        "Until that review is complete, this draft does not claim a particular transfer mechanism, adequacy status, data-residency guarantee, or universal compliance.",
        "在审阅完成前，本草案不声称适用某一特定传输机制、充分性认定、数据驻留保证或普遍合规。"
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
        "The privacy and support functions currently share the operator’s published personal mailbox. The four alternatives in the official site footer are also personal channels and may be used if email or another channel is unavailable. The legal service address, response workflow, and final monitoring verification remain incomplete; do not mark this policy effective until every release gate is complete.",
        "隐私与支持目前共用运营者已公布的个人邮箱。官网底部的四个备用入口同样属于个人联系方式；如邮箱或某一渠道不可用，可改用其他渠道。法律送达地址、响应流程及最终监控核验仍未完成；所有发布门禁完成前不得将本政策标记为生效。"
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
  recipientAndRegion: text(...recipientAndRegion),
  retention: text(...retention),
  deletion: text(...deletion)
});

export const DATA_PRACTICES: readonly DataPractice[] = [
  practice(
    "local-workspace-data",
    ["Sessions, memory, projects, and workspaces", "会话、记忆、项目与工作区"],
    [
      "Prompts, messages, summaries, plans, checkpoints, project paths and instructions, remembered facts, tabs, layout, and preferences created through use.",
      "使用过程中产生的提示词、消息、摘要、计划、checkpoint、项目路径与指令、记忆事实、标签、布局和偏好。"
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
      "Signals are read locally each turn. The derived Persona is sent to the selected model; raw clues are not necessarily sent verbatim.",
      "每轮在本机读取线索；推导出的 Persona 发送给所选模型，原始线索不一定逐字发送。"
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
      "Google, Supabase, and Lyra; Supabase project region is unconfirmed and must not be guessed.",
      "Google、Supabase 和 Lyra；Supabase 项目地区尚未确认且不得猜测。"
    ],
    [
      "Supabase/provider policy and account configuration; session tokens and identity cache persist locally until cleared or replaced.",
      "依 Supabase/服务商政策和账户配置；会话令牌与身份缓存会在本机保留至清理或替换。"
    ],
    [
      "Sign out for the active session and clear local data separately. No verified self-service cloud-account deletion flow currently exists.",
      "退出当前会话并另行清理本机数据。目前没有经核验的自助云端账户删除流程。"
    ]
  ),
  practice(
    "credentials",
    ["Form credentials and provider keys", "表单凭证与服务商密钥"],
    [
      "Login-form usernames/passwords automatically observed on submit/change; model API keys; browser sessions; MCP headers and environment values.",
      "表单提交/变更时自动观察的登录用户名/密码；模型 API 密钥；浏览器会话；MCP 请求头与环境变量。"
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
      "Typed query text after a short debounce, submitted searches, destination URLs, ordinary request metadata, and retrieved content.",
      "短暂防抖后已输入的查询文本、已提交搜索、目标 URL、通常请求元数据及检索内容。"
    ],
    [
      "Suggest, search, browse, summarize, and use web evidence.",
      "提供建议、搜索、浏览、摘要并使用网页证据。"
    ],
    [
      "Google Suggest, Wikipedia, the configured web-search service, and visited websites in their provider-controlled regions.",
      "Google Suggest、Wikipedia、所配置网页搜索服务及访问的网站，由各服务商控制处理地区。"
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
      "Exact latitude, longitude, locale, reverse-geocoded place label, authorization state, and timestamp/context.",
      "准确纬度、经度、区域语言、逆地理编码地点标签、授权状态和时间/上下文。"
    ],
    [
      "Display a readable place and provide authorized location context.",
      "展示可读地点并提供经授权的位置上下文。"
    ],
    [
      "Exact coordinates and locale go to the public Nominatim endpoint; the resulting label can go to the selected model. Nominatim’s public policy warns against personal/confidential submissions.",
      "精确坐标与区域语言发送至公共 Nominatim 端点；所得标签可发送给所选模型。Nominatim 公共政策警告不要提交个人/机密数据。"
    ],
    [
      "Local context retention and recipient policy; exact provider retention is not verified.",
      "依本机上下文保留及接收方政策；服务商确切保留时间尚未核验。"
    ],
    [
      "Decline/revoke OS location permission and clear local context; remote requests may follow recipient retention.",
      "拒绝/撤回操作系统位置权限并清理本机上下文；远程请求可能依接收方政策保留。"
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
