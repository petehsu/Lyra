import type {
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

export const TERMS_DOCUMENT: LegalDocument = {
  id: "terms",
  title: text("Lyra Terms of Use", "Lyra 用户协议"),
  description: text(
    "The rules for using the Lyra desktop beta, its Agent features, and third-party integrations.",
    "使用 Lyra 桌面测试版、Agent 功能及第三方集成时适用的规则。"
  ),
  sections: [
    section(
      "draft-status-and-acceptance",
      "Publication status and acceptance",
      "发布状态与接受方式",
      notice(
        "Version 1.0.0 is effective from August 6, 2026 for Lyra Desktop 0.1.0-preview.5. It governs use after the versioned acceptance described below.",
        "1.0.0 版本自 2026 年 8 月 6 日起对 Lyra Desktop 0.1.0-preview.5 生效，并按照下述版本化确认方式约束确认后的使用。"
      ),
      paragraph(
        "Before first use, and again when the legal document version changes, Lyra requires you to open or have access to the Terms and Privacy Policy, actively check an acceptance box, and continue. The app stores the accepted document version and timestamp locally on that device. If you do not agree, do not use Lyra. Downloading, installing, accessing, or continuing to use Lyra after that confirmation also constitutes acceptance of the published version.",
        "首次使用前以及法律文档版本变更后，Lyra 会要求您能够打开用户协议与隐私政策、主动勾选同意框并继续。应用会在该设备本机保存已接受的文档版本及时间。如不同意，请勿使用 Lyra；完成确认后下载、安装、访问或继续使用 Lyra，也构成对已发布版本的接受。"
      ),
      paragraph(
        "The English and Simplified Chinese texts use the same version, section identifiers, status, and effective date and have equal authority. If the wording appears inconsistent, interpret both texts together to best preserve their shared meaning and mandatory consumer rights.",
        "英文与简体中文文本共享同一版本、章节 ID、状态和生效日期，具有同等效力。如表述看似不一致，应结合两种文本解释，以最大程度保留共同含义及消费者不可放弃的法定权利。"
      )
    ),
    section(
      "operator-and-eligibility",
      "Operator and eligibility",
      "运营者与使用资格",
      paragraph(
        "Lyra is provided under the Lyra name by 徐远豪 (Pete Hsu), an individual developer based in mainland China (the “Developer,” “Lyra,” “we,” or “us”). Lyra is not represented as an incorporated overseas company.",
        "Lyra 由中国大陆个人开发者徐远豪（Pete Hsu）以 Lyra 名义提供（下称“开发者”“Lyra”或“我们”）。Lyra 并非虚构或声称为一家境外注册公司。"
      ),
      paragraph(
        "You must be at least 18 years old and legally capable of entering this agreement. If you use Lyra for an organization, you represent that you are authorized to bind it; consumer rights that legally attach to you personally remain unaffected.",
        "您必须年满 18 周岁并具有订立本协议的法律能力。如代表组织使用 Lyra，您声明有权使该组织受本协议约束；依法归属于您个人的消费者权利不受影响。"
      )
    ),
    section(
      "beta-and-market-scope",
      "Free beta and market scope",
      "免费测试版与市场范围",
      paragraph(
        "The current release is a free beta. There is no paid subscription, automatic renewal, tax collection, or refund program under this version. Any future paid offering will require separate, clearly disclosed commercial terms before charges begin.",
        "当前版本为免费测试版。本版本不存在付费订阅、自动续费、代收税费或退款计划。未来如提供付费服务，将在收费前另行明确公布商业条款。"
      ),
      paragraph(
        "Lyra is developed with an overseas-first distribution focus and is not actively offered for local distribution in mainland China. Chinese language support does not change that positioning. We do not guarantee that third-party models, websites, downloads, or network services are lawful, licensed, reachable, or performant in any particular location or network environment.",
        "Lyra 以海外优先为发行定位，不主动面向中国大陆本地发行。提供中文语言支持不改变该定位。我们不保证第三方模型、网站、下载内容或网络服务在任何特定地区或网络环境中合法、获许可、可访问或性能稳定。"
      )
    ),
    section(
      "software-license",
      "Software license and restrictions",
      "软件许可与限制",
      paragraph(
        "Subject to this agreement, Lyra grants you a limited, personal, revocable, non-exclusive, non-transferable license to install and use the supplied object-code beta for lawful internal or personal purposes. Lyra is closed-source proprietary software except for separately identified third-party components.",
        "在遵守本协议的前提下，Lyra 授予您一项有限的、个人的、可撤销的、非独占且不可转让的许可，仅为合法的内部或个人目的安装和使用所提供的目标代码测试版。除另行标识的第三方组件外，Lyra 为闭源专有软件。"
      ),
      list(
        [
          "Do not copy, sell, sublicense, rent, host, or distribute Lyra except where mandatory law or an applicable open-source license permits it.",
          "除强制法律或适用开源许可允许外，不得复制、销售、再许可、出租、托管或分发 Lyra。"
        ],
        [
          "Do not bypass license, security, permission, update, or integrity controls, or use Lyra to gain unauthorized access.",
          "不得绕过许可、安全、权限、更新或完整性控制，也不得利用 Lyra 获取未经授权的访问。"
        ],
        [
          "Do not reverse engineer or derive source code except to the limited extent that applicable law expressly makes that right non-waivable.",
          "不得逆向工程或推导源代码，但适用法律明确规定相关权利不可放弃的有限范围除外。"
        ],
        [
          "Third-party notices and licenses control for their covered components and are not restricted by this proprietary license.",
          "第三方声明和许可对其覆盖的组件优先适用，不受本专有许可限制。"
        ]
      )
    ),
    section(
      "accounts-credentials-and-backups",
      "Accounts, credentials, and backups",
      "账户、凭证与备份",
      paragraph(
        "Lyra may be used locally without signing in for some functions, and may also support a Google-backed Lyra account. You are responsible for your device, account, model API keys, MCP headers and environment values, website sessions, and every action taken through them. Do not share credentials with a person or extension you do not trust.",
        "部分功能可在不登录的本地模式下使用，Lyra 也可支持通过 Google 登录的 Lyra 账户。您应对设备、账户、模型 API 密钥、MCP 请求头与环境变量、网站会话以及通过它们执行的操作负责。请勿向不受信任的人员或扩展共享凭证。"
      ),
      paragraph(
        "The browser login manager can capture submitted form credentials only after you explicitly enable automatic password capture, and encrypts saved passwords locally using Electron safeStorage. MCP secrets are handled differently: headers and environment values are saved in a local JSON registry and only visually redacted in the interface. Protect your operating-system account and backups accordingly.",
        "浏览器登录管理器仅在您明确开启自动密码捕获后才会捕获已提交的表单凭证，并使用 Electron safeStorage 在本机加密所保存的密码。MCP 密钥的处理方式不同：请求头和环境变量保存在本地 JSON 注册表中，界面仅作视觉脱敏。请据此保护操作系统账户和备份。"
      ),
      paragraph(
        "Maintain independent backups and version-control history for important work. Checkpoints, rollback, autosave, session history, or provider retention are workflow aids, not guaranteed backups or disaster recovery.",
        "请为重要工作保留独立备份和版本控制历史。checkpoint、rollback、自动保存、会话历史或服务商保留机制仅为工作辅助，不构成保证的备份或灾难恢复方案。"
      )
    ),
    section(
      "user-content-and-ai-output",
      "User content and AI output",
      "用户内容与 AI 输出",
      paragraph(
        "You retain the rights you hold in prompts, files, code, images, webpages, instructions, and other content you provide (“User Content”). You grant Lyra a limited right to process User Content only as needed to operate requested features, secure the service, comply with law, and enforce this agreement. You must have the rights and permissions needed for content you provide.",
        "您保留对提示词、文件、代码、图片、网页、指令及其他所提供内容（“用户内容”）享有的权利。您仅为运行所请求功能、保障服务安全、遵守法律和执行本协议之必要，授予 Lyra 有限处理用户内容的权利。您必须拥有提供相关内容所需的权利和许可。"
      ),
      paragraph(
        "As between you and Lyra, and to the extent the law permits, you may use AI output generated for you. Output may be inaccurate, incomplete, unsafe, non-unique, or subject to third-party rights and provider terms. Lyra does not transfer rights it does not have and does not guarantee that output is protectable, original, or fit for a purpose.",
        "在您与 Lyra 之间，并在法律允许范围内，您可以使用为您生成的 AI 输出。输出可能不准确、不完整、不安全、并非唯一，或受第三方权利及服务商条款约束。Lyra 不转让其不拥有的权利，也不保证输出可受保护、具有原创性或适合特定目的。"
      )
    ),
    section(
      "agents-and-automation",
      "Agents, automation, and human review",
      "Agent、自动化与人工复核",
      paragraph(
        "Solo, browser automation, Computer Use, terminal, file, Git, download, and other tools can inspect data and take actions with real effects. Depending on your permission settings and instructions, an Agent may modify or delete files, run commands, browse while signed in, communicate with remote services, install code, make purchases, or trigger external workflows. Preview or Experimental features, including Oma where available, may be less predictable.",
        "Solo、浏览器自动化、Computer Use、终端、文件、Git、下载等工具能够检查数据并执行产生真实后果的操作。根据您的权限设置和指令，Agent 可能修改或删除文件、运行命令、在登录状态下浏览、与远程服务通信、安装代码、购买商品或触发外部流程。Preview 或 Experimental 功能（包括可用时的 Oma）可能更不可预测。"
      ),
      list(
        [
          "Review plans, permission prompts, targets, diffs, commands, recipients, prices, and final output before consequential actions.",
          "在有重大后果的操作前，复核计划、权限提示、目标、差异、命令、接收方、价格和最终输出。"
        ],
        [
          "Use least-privilege accounts and isolated browser profiles when practical; borrowing a live profile can expose existing signed-in sessions.",
          "尽可能使用最小权限账户和隔离浏览器 profile；借用 live profile 可能暴露现有登录会话。"
        ],
        [
          "Do not rely on Lyra for emergencies or as the sole decision-maker in legal, medical, financial, employment, safety, or other high-impact matters.",
          "不得将 Lyra 用于紧急情况，也不得在法律、医疗、金融、就业、安全或其他高影响事项中将其作为唯一决策者。"
        ]
      ),
      paragraph(
        "You remain responsible for authorizing, supervising, stopping, reviewing, and, where possible, reversing Agent actions.",
        "您始终负责授权、监督、停止、复核并在可能时撤销 Agent 的操作。"
      )
    ),
    section(
      "third-party-services-and-extensions",
      "Third-party services and extensions",
      "第三方服务与扩展",
      paragraph(
        "Lyra can connect to user-selected AI providers, custom compatible endpoints, local models, Supabase and Google sign-in, search services, websites, MCP servers, Skills sources, UIUX Packs, software capabilities, language-pack sources, and update infrastructure. Those parties operate under their own terms, privacy practices, regions, availability, retention, and training rules.",
        "Lyra 可连接用户选择的 AI 服务商、自定义兼容端点、本地模型、Supabase 与 Google 登录、搜索服务、网站、MCP 服务器、Skills 来源、UIUX Pack、软件能力、语言包来源和更新基础设施。这些第三方适用其自身条款、隐私做法、处理地区、可用性、保留及训练规则。"
      ),
      paragraph(
        "Skills and MCP integrations may send data and perform actions declared by their configuration, but permission fields can be descriptive metadata rather than enforced isolation. UIUX Packs are trusted code with access to the full Lyra Desktop API; they are not sandboxed. Review source, publisher, configuration, requested access, and destination before installation or use.",
        "Skills 和 MCP 集成可能按其配置发送数据并执行操作，但权限字段可能只是声明性元数据，并不代表已执行的隔离。UIUX Pack 是可访问完整 Lyra Desktop API 的受信任代码，并非沙箱。安装或使用前请核查来源、发布者、配置、所需访问及数据目的地。"
      ),
      paragraph(
        "Lyra is not responsible for third-party content or services and does not endorse them merely because they appear in a catalog or configuration screen. Your contract with a third party remains between you and that party.",
        "Lyra 不对第三方内容或服务负责；第三方出现在目录或配置界面中并不表示 Lyra 为其背书。您与第三方之间的合同关系仍由您和该第三方承担。"
      )
    ),
    section(
      "acceptable-use",
      "Acceptable use",
      "可接受使用",
      paragraph(
        "Use Lyra only lawfully and with authority. You must not use it to:",
        "仅可在合法并获得授权的情况下使用 Lyra。您不得利用 Lyra："
      ),
      list(
        [
          "harm, threaten, exploit, stalk, discriminate against, or facilitate abuse of any person;",
          "伤害、威胁、剥削、跟踪、歧视任何人，或协助实施虐待；"
        ],
        [
          "access systems, accounts, credentials, personal data, networks, or content without authorization;",
          "未经授权访问系统、账户、凭证、个人信息、网络或内容；"
        ],
        [
          "create or distribute malware, evade security controls, conduct credential theft, destructive automation, spam, fraud, or unlawful surveillance;",
          "制作或传播恶意软件、规避安全控制、窃取凭证、实施破坏性自动化、垃圾信息、欺诈或非法监控；"
        ],
        [
          "violate intellectual-property, privacy, data-protection, export-control, sanctions, consumer-protection, or other applicable law;",
          "违反知识产权、隐私、数据保护、出口管制、制裁、消费者保护或其他适用法律；"
        ],
        [
          "misrepresent AI output as verified human work where that would deceive or cause harm.",
          "在会造成欺骗或损害的场景中，将 AI 输出冒充已核验的人类成果。"
        ]
      )
    ),
    section(
      "updates-availability-and-changes",
      "Updates, availability, and changes",
      "更新、可用性与变更",
      paragraph(
        "The beta may change, break, lose data, or be discontinued. Features may be labeled Stable, Preview, or Experimental; those labels describe product maturity, not a service-level commitment. We may issue automatic or manual updates, change compatibility, remove unsafe functionality, or require a newer version for security or third-party compatibility.",
        "测试版可能发生变化、中断、丢失数据或停止提供。功能可能标为 Stable、Preview 或 Experimental；这些标签仅描述产品成熟度，不构成服务等级承诺。我们可能提供自动或手动更新、改变兼容性、移除不安全功能，或因安全与第三方兼容要求使用较新版本。"
      ),
      paragraph(
        "We do not promise uninterrupted operation, continued access to any model, website, account provider, package source, or download, or support for every operating system and device.",
        "我们不保证持续不中断运行，也不保证任何模型、网站、账户服务商、包来源或下载始终可访问，或支持所有操作系统和设备。"
      )
    ),
    section(
      "suspension-and-termination",
      "Suspension and termination",
      "暂停与终止",
      paragraph(
        "You may stop using Lyra and remove local data using available controls. We may suspend or terminate access to Lyra-operated online functions where reasonably necessary for security, legal compliance, abuse prevention, service integrity, or material breach. Where law requires and circumstances permit, we will provide notice and an opportunity to address the issue.",
        "您可以停止使用 Lyra，并通过现有控制删除本机数据。为保障安全、遵守法律、防止滥用、维护服务完整性或处理重大违约，我们可在合理必要范围内暂停或终止由 Lyra 运营的在线功能。在法律要求且情况允许时，我们将提供通知和处理问题的机会。"
      ),
      paragraph(
        "Termination does not automatically delete data held by independent providers or backups. Provisions that by their nature should survive—including ownership, third-party licenses, disclaimers, liability limits, and dispute terms—continue to apply.",
        "终止不会自动删除独立第三方服务商或备份中持有的数据。依其性质应继续有效的条款，包括所有权、第三方许可、免责声明、责任限制和争议条款，在终止后继续适用。"
      )
    ),
    section(
      "disclaimers",
      "Disclaimers",
      "免责声明",
      paragraph(
        "To the maximum extent permitted by law, Lyra and all output are provided “as is” and “as available.” We disclaim implied warranties of merchantability, fitness for a particular purpose, accuracy, quiet enjoyment, non-infringement, availability, security, and data preservation. No documentation, model response, Agent plan, checkpoint, permission prompt, or support communication creates a warranty.",
        "在法律允许的最大范围内，Lyra 及所有输出均按“现状”和“可用状态”提供。我们不提供关于适销性、特定用途适用性、准确性、平稳使用、不侵权、可用性、安全性或数据保存的默示保证。任何文档、模型响应、Agent 计划、checkpoint、权限提示或支持沟通均不构成保证。"
      ),
      paragraph(
        "Some jurisdictions do not permit certain exclusions. In that case, the exclusion applies only to the extent legally permitted, and your non-waivable rights remain.",
        "部分司法辖区不允许某些免责；在该等情况下，免责仅在法律允许范围内适用，您的不可放弃权利仍予保留。"
      )
    ),
    section(
      "limitation-of-liability",
      "Limitation of liability",
      "责任限制",
      paragraph(
        "For non-consumer use, to the maximum extent permitted by law, Lyra will not be liable for indirect, incidental, special, exemplary, punitive, or consequential loss, or for lost profits, revenue, business, goodwill, data, credentials, or opportunities, arising from Lyra, AI output, Agent actions, or third-party services.",
        "对于非消费者使用，在法律允许的最大范围内，Lyra 不对因 Lyra、AI 输出、Agent 操作或第三方服务产生的间接、附带、特殊、示范性、惩罚性或后果性损失，亦不对利润、收入、业务、商誉、数据、凭证或机会损失承担责任。"
      ),
      paragraph(
        "For non-consumer use, Lyra’s total aggregate liability for all claims is limited to the greater of (a) the fees you actually paid to Lyra during the twelve months before the event giving rise to the claim and (b) US$100.",
        "对于非消费者使用，Lyra 对全部索赔承担的累计责任总额，以以下两者中较高者为限：(a) 导致索赔的事件发生前十二个月内您实际向 Lyra 支付的费用；或 (b) 100 美元。"
      ),
      paragraph(
        "These exclusions and caps do not apply to intentional misconduct, gross negligence, liability that cannot lawfully be excluded or limited, or mandatory consumer remedies. Nothing in this agreement limits non-waivable rights concerning personal injury, fraud, product liability, privacy, or other matters where applicable law forbids limitation.",
        "上述免责和上限不适用于故意行为、重大过失、依法不得排除或限制的责任，或强制性消费者救济。本协议不限制适用法律禁止限制的人身伤害、欺诈、产品责任、隐私或其他事项相关的不可放弃权利。"
      )
    ),
    section(
      "governing-law-and-disputes",
      "Governing law and disputes",
      "适用法律与争议解决",
      paragraph(
        "Mandatory consumer protections apply regardless of this section. If you are a consumer, you retain every non-waivable right under the law of your habitual residence, including access to any court or dispute forum that law makes available to you.",
        "无论本节如何规定，强制性消费者保护均继续适用。如您属于消费者，您保留惯常居住地法律赋予的一切不可放弃权利，包括该法律为您提供的法院或争议解决渠道。"
      ),
      paragraph(
        "For all other use, this agreement is governed by the laws of mainland China, without regard to conflict-of-laws rules. Before filing a claim, each party should send a written description and allow at least 30 days for good-faith consultation. If consultation fails, disputes are submitted to the competent People’s Court at the Developer’s domicile, unless mandatory law requires another forum.",
        "对于其他使用，本协议适用中国大陆法律，但不适用其冲突规范。提起诉讼前，各方应书面说明争议，并至少预留 30 日进行善意协商；协商不成的，争议提交开发者住所地有管辖权的人民法院处理，但强制法律要求其他法院或渠道的除外。"
      ),
      paragraph(
        "This agreement does not require US-style binding arbitration and does not waive class, collective, representative, jury, or court rights where such a waiver would be invalid.",
        "本协议不引入美国式强制仲裁，也不在相关放弃无效的情况下要求您放弃集体、共同、代表性、陪审团或法院权利。"
      )
    ),
    section(
      "agreement-changes-and-contact",
      "Changes and contact",
      "协议变更与联系",
      paragraph(
        "A material terms change will receive a new version and effective date and will be recorded in Legal History. Where law requires consent rather than notice, continued use alone will not replace that consent. Earlier versions remain available through the history record.",
        "重大协议变更将采用新版本和生效日期，并记录在“法律版本历史”中。如法律要求取得同意而非仅作通知，继续使用不能替代该同意。历史记录将保留先前版本。"
      ),
      notice(
        "The published support and privacy mailbox is the operator’s personal email, and the four alternatives listed in the official site footer are also maintained personally rather than by a staffed support desk. Delivery or timely review is not guaranteed for any single channel; if a message receives no response within a reasonable time, try another listed channel. Do not send passwords, API keys, or other sensitive information through public channels. The operator confirmed that the published physical address is the complete community address used for parcel delivery; the end-to-end contact test remains a release gate.",
        "已公布的支持与隐私邮箱是运营者的个人邮箱，官网底部列出的四个备用渠道也均由运营者本人维护，并非专职客服系统。任何单一渠道均不保证送达或被及时查看；如在合理时间内未收到回复，请改用其他列明渠道。请勿通过公开渠道发送密码、API 密钥或其他敏感信息。运营者已确认所公布物理地址即实际使用的完整小区快递地址；端到端联系测试仍属于发布门禁。"
      )
    )
  ]
};
