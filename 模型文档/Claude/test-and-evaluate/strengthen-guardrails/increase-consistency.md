# 提高输出一致性

---

<Tip>
**如需保证 JSON 模式一致性**

如果您需要 Claude 始终输出符合特定模式的有效 JSON，请使用 [Structured Outputs（结构化输出）](/docs/zh-CN/build-with-claude/structured-outputs)，而不是下面的提示工程技巧。结构化输出可保证模式合规性，并且是专门为此用例设计的。

下面的技巧适用于一般的输出一致性需求，或当您需要超出严格 JSON 模式的灵活性时。
</Tip>

以下是使 Claude 的响应更加一致的方法：

## 指定所需的输出格式 \{#specify-the-desired-output-format}
使用 JSON、XML 或自定义模板精确定义您所需的输出格式，以便 Claude 理解您要求的每个输出格式元素。

<section title="示例：标准化客户反馈">

    | 角色 | 内容 |
    | ---- | ------- |
    | User | 您是一个客户洞察 AI。分析此反馈并以 JSON 格式输出，包含以下键："sentiment"（positive/negative/neutral）、"key_issues"（列表）和 "action_items"（包含 "team" 和 "task" 的字典列表）。<br/><br/>"I've been a loyal user for 3 years, but the recent UI update is a disaster. Finding basic features is now a scavenger hunt. Plus, the new 'premium' pricing is outrageous. I'm considering switching unless this is fixed ASAP." |
    | Assistant | \{<br/>  "sentiment": "negative",<br/>  "key_issues": [<br/>    "Poor UI/UX in recent update",<br/>    "Difficulty finding basic features",<br/>    "Perceived high pricing (new 'premium' tier)"<br/>  ],<br/>  "action_items": [<br/>    \{<br/>      "team": "Product",<br/>      "task": "Conduct usability testing and iterate on UI based on findings"<br/>    \},<br/>    \{<br/>      "team": "UX",<br/>      "task": "Create a feature discovery guide or onboarding flow"<br/>    \},<br/>    \{<br/>      "team": "Marketing",<br/>      "task": "Review pricing strategy and communicate value proposition"<br/>    },<br/>    \{<br/>      "team": "Customer Success",<br/>      "task": "Reach out to user, offer concessions to prevent churn"<br/>    \}<br/>  ]<br/>\} |

</section>

## 预填充 Claude 的响应 \{#prefill-claudes-response}

<Note>Claude Fable 5、[Claude Mythos 5](https://anthropic.com/glasswing)、[Claude Mythos Preview](https://anthropic.com/glasswing)、Claude Opus 4.8、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 不支持预填充。请在支持的模型上使用[结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)，或改用系统提示指令。</Note>

使用您所需的格式预填充 `Assistant` 回合。此技巧可绕过 Claude 友好的开场白并强制执行您的结构。

<section title="示例：每日销售报告">

    | 角色 | 内容 |
    | ---- | ------- |
    | User | 您是一个富有洞察力的销售智能 AI。生成今天的销售报告。<br/><br/>按如下结构组织报告：<br/><br/>\<report><br/>    \<summary><br/>        \<metric name="total_revenue">\$0.00\</metric><br/>        \<metric name="units_sold">0\</metric><br/>        \<metric name="avg_order_value">\$0.00\</metric><br/>    \</summary><br/>    \<top_products><br/>        \<br/>            \<name>Product Name\</name><br/>            \<revenue>\$0.00\</revenue><br/>            \<units>0\</units><br/>        \</product><br/>        ...<br/>    \</top_products><br/>    \<regional_performance><br/>        \<region><br/>            \<name>Region Name\</name><br/>            \<revenue>\$0.00\</revenue><br/>            \<growth>0.0%\</growth><br/>        \</region><br/>        ...<br/>    \</regional_performance><br/>    \<action_items><br/>        \<item>Action item.\</item><br/>        ...<br/>    \</action_items><br/>\</report> |
    | Assistant（预填充） | \<report><br/>    \<summary><br/>        \<metric name= |
    | Assistant | "total_revenue">\$842,567.00\</metric><br/>        \<metric name="units_sold">15,238\</metric><br/>        \<metric name="avg_order_value">\$55.29\</metric><br/>    \</summary><br/>    \<top_products><br/>        \<br/>            \<name>AcmeGuard Pro\</name><br/>            \<revenue>\$325,890.00\</revenue><br/>            \<units>3,621\</units><br/>        \</product><br/>        \<br/>            \<name>AcmeVault Enterprise\</name><br/>            \<revenue>\$254,400.00\</revenue><br/>            \<units>1,272\</units><br/>        \</product><br/>        \<br/>            \<name>AcmeBoost XL\</name><br/>            \<revenue>\$147,690.00\</revenue><br/>            \<units>4,923\</units><br/>        \</product><br/>    \</top_products><br/>    \<regional_performance><br/>        \<region><br/>            \<name>APAC\</name><br/>            \<revenue>\$258,960.00\</revenue><br/>            \<growth>12.8%\</growth><br/>        \</region><br/>        \<region><br/>            \<name>EMEA\</name><br/>            \<revenue>\$325,478.00\</revenue><br/>            \<growth>3.2%\</growth><br/>        \</region><br/>        \<region><br/>            \<name>Americas\</name><br/>            \<revenue>\$258,129.00\</revenue><br/>            \<growth>-2.1%\</growth><br/>        \</region><br/>    \</regional_performance><br/>    \<action_items><br/>        \<item>Investigate Americas revenue drop; schedule regional sales team meeting.\</item><br/>        \<item>Accelerate CloudGuard Pro rollout in APAC to capitalize on growth.\</item><br/>        \<item>Review NetBoost XL pricing; high volume but lower revenue.\</item><br/>    \</action_items><br/>\</report> |

</section>

## 使用示例进行约束 \{#constrain-with-examples}
提供您所需输出的示例。这比抽象的指令更能训练 Claude 的理解能力。

<section title="示例：生成一致的市场情报">

    | 角色 | 内容 |
    | ---- | ------- |
    | User | 作为市场情报 AI，您的任务是分析有关我们竞争对手的数据。以下是我们的竞争对手数据：<br/>\<data><br/>\{\{DATA}}<br/>\</data><br/><br/>按照以下示例格式输出：<br/><br/>\<competitor><br/>  \<name>Rival Inc\</name><br/>  \<overview>A 50-word summary.\</overview><br/>  \<swot><br/>    \<strengths>- Bullet points\</strengths><br/>    \<weaknesses>- Bullet points\</weaknesses><br/>    \<opportunities>- Bullet points\</opportunities><br/>    \<threats>- Bullet points\</threats><br/>  \</swot><br/>  \<strategy>A 30-word strategic response.\</strategy><br/>\</competitor><br/><br/>现在，使用此格式分析 AcmeGiant 和 AcmeDataCo。 |
    | Assistant | \<competitor><br/>  \<name>AcmeGiant\</name><br/>  \<overview>Global tech leader with a vast ecosystem of consumer and enterprise products. Known for innovation, strong brand, and deep customer lock-in through integrated hardware, software, and services.\</overview><br/>  \<swot><br/>    \<strengths><br/>      - Massive R\&D budget fuels continuous innovation<br/>      - Loyal customer base and powerful brand recognition<br/>      - Synergistic product ecosystem increases switching costs<br/>    \</strengths><br/>    \<weaknesses><br/>      - High prices may deter cost-sensitive customers<br/>      - Slow to address enterprise-specific customization needs<br/>      - Privacy concerns and regulatory scrutiny in multiple markets<br/>    \</weaknesses><br/>    \<opportunities><br/>      - Growing demand for AI and ML capabilities<br/>      - Expansion into emerging markets<br/>      - Acquisitions to fill product or talent gaps<br/>    \</opportunities><br/>    \<threats><br/>      - Rapid rise of cloud-native competitors<br/>      - Antitrust lawsuits and regulatory actions<br/>      - Talent poaching by startups and competitors<br/>    \</threats><br/>  \</swot><br/>  \<strategy>Focus on our agility and customization. Target TechGiant's slow enterprise response and privacy issues in our marketing.\</strategy><br/>\</competitor><br/><br/>\<competitor><br/>  \<name>AcmeDataCo\</name><br/>  \<overview>Rising star in data analytics and visualization. Offers intuitive, self-service BI tools with a freemium model, appealing to startups and enterprise teams alike.\</overview><br/>  \<swot><br/>    \<strengths><br/>      - User-friendly interface reduces need for specialized training<br/>      - Freemium model lowers barrier to entry, drives viral growth<br/>      - Strong product-market fit with rise of data-driven decisions<br/>    \</strengths><br/>    \<weaknesses><br/>      - Limited advanced analytics compared to established BI tools<br/>      - Scaling issues reported with very large datasets<br/>      - Dependent on third-party cloud infrastructure (AWS)<br/>    \</weaknesses><br/>    \<opportunities><br/>      - Expanding into predictive analytics and AI-driven insights<br/>      - Forming strategic alliances with complementary tech vendors<br/>      - Customizable dashboards for industry-specific solutions<br/>    \</opportunities><br/>    \<threats><br/>      - Market saturation; many new entrants in self-service BI<br/>      - Enterprise BI giants developing more user-friendly tools<br/>      - Data privacy regulations increasing compliance complexity<br/>    \</threats><br/>  \</swot><br/>  \<strategy>Highlight our robust enterprise features and data governance. Target accounts struggling with DataCo's scale limitations.\</strategy><br/>\</competitor> |

</section>

## 使用检索实现上下文一致性 \{#use-retrieval-for-contextual-consistency}
对于需要一致上下文的任务（例如聊天机器人、知识库），使用检索将 Claude 的响应锚定在固定的信息集中。

<section title="示例：增强 IT 支持一致性">

    | 角色 | 内容 |
    | ---- | ------- |
    | User | 您是我们的 IT 支持 AI，基于知识库数据提供帮助。以下是您知识库中的条目：<br/><br/>\<kb><br/>  \<entry><br/>    \<id>1\</id><br/>    \<title>Reset Active Directory password\</title><br/>    \<content>1. Go to password.ourcompany.com<br/>2. Enter your username<br/>3. Click "Forgot Password"<br/>4. Follow email instructions\</content><br/>  \</entry><br/>  \<entry><br/>    \<id>2\</id><br/>    \<title>Connect to VPN\</title><br/>    \<content>1. Install GlobalProtect from software center<br/>2. Open GlobalProtect, enter "vpn.ourcompany.com"<br/>3. Use AD credentials to log in\</content><br/>  \</entry><br/>\</kb><br/><br/>在帮助用户时，请始终先查看知识库。按以下格式响应：<br/><br/>\<response><br/>  \<kb_entry>Knowledge base entry used\</kb_entry><br/>  \<answer>Your response\</answer><br/>\</response> 为自己编写一些测试问题并使用知识库回答它们，以确保您了解如何正确使用知识库。 |
    | Assistant | 明白了。我将使用知识库来提供一致的响应。让我们用几个场景来测试一下。<br/><br/>用户：嘿，我无法登录我的电子邮件。我想我忘记密码了。<br/><br/>\<response><br/>  \<kb_entry>1: Reset Active Directory password\</entry><br/>  \<answer>我了解到您由于忘记密码而无法登录电子邮件。别担心，这是一个常见问题。要重置您的 Active Directory 密码（用于电子邮件访问），请按照以下步骤操作：<br/><br/>1. 访问 password.ourcompany.com<br/>2. 输入您的用户名（与您的电子邮件地址相同）<br/>3. 点击"Forgot Password"链接<br/>4. 您将收到一封包含说明的电子邮件。按照说明重置您的密码。<br/><br/>重置后，您应该能够登录您的电子邮件。如果您需要任何进一步的帮助，请告诉我。\</answer><br/>\</response><br/><br/>用户：我今天在家办公。如何访问内部资源？<br/><br/>\<response><br/>  \<kb_entry>2: Connect to VPN\</entry><br/>  \<answer>好问题！要在家办公时访问内部资源，您需要连接到我们公司的 VPN（虚拟专用网络）。设置方法如下：<br/><br/>1. 首先，安装 GlobalProtect VPN 客户端。您可以在我们的软件中心找到它。<br/>2. 安装完成后，打开 GlobalProtect 应用程序。<br/>3. 在服务器字段中，输入"vpn.ourcompany.com"。<br/>4. 使用您的 Active Directory (AD) 凭据登录——与您用于电子邮件的用户名和密码相同。<br/><br/>连接后，您将可以安全地访问所有内部资源，就像在办公室一样。如果您在设置过程中遇到任何问题，请告诉我。\</answer><br/>\</response> |

</section>

## 为复杂任务链接提示 \{#chain-prompts-for-complex-tasks}
将复杂任务分解为更小、更一致的子任务。每个子任务都能获得 Claude 的充分关注，从而减少大规模工作流程中的不一致错误。

## 让 Claude 保持角色 \{#keep-claude-in-character}

对于基于角色的应用，保持一致的角色需要刻意的提示设计。

- **使用系统提示设置角色：** 使用[系统提示](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#give-claude-a-role)来定义 Claude 的角色和个性。这为一致的响应奠定了坚实的基础。
    <Tip>在设置角色时，提供有关个性、背景以及任何特定特征或癖好的详细信息。这将帮助模型更好地模拟和泛化角色的特征。</Tip>
- **让 Claude 为可能的场景做好准备：** 在您的提示中提供常见场景和预期响应的列表。这可以"训练" Claude 在不脱离角色的情况下处理各种情况。

<section title="示例：用于角色提示的企业聊天机器人">

    | 角色 | 内容 |
    | ---- | ------- |
    | System | 您是 AcmeBot，AcmeTechCo 的企业级 AI 助手。您的职责：<br/>    - 分析技术文档（TDD、PRD、RFC）<br/>    - 为工程、产品和运营团队提供可操作的洞察<br/>    - 保持专业、简洁的语气 |
    | User | 以下是您需要响应的用户查询：<br/>\<user_query><br/>\{\{USER_QUERY}}<br/>\</user_query><br/><br/>您的交互规则是：<br/>    - 始终参考 AcmeTechCo 标准或行业最佳实践<br/>    - 如果不确定，请在继续之前要求澄清<br/>    - 切勿泄露 AcmeTechCo 的机密信息。<br/><br/>作为 AcmeBot，您应按照以下准则处理各种情况：<br/>    - 如果被问及 AcmeTechCo 知识产权："I cannot disclose TechCo's proprietary information."<br/>    - 如果被问及最佳实践："Per ISO/IEC 25010, we prioritize..."<br/>    - 如果对文档不清楚："To ensure accuracy, please clarify section 3.2..." |

</section>