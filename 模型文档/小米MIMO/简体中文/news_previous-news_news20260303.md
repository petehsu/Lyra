# MiMo-V2-Flash 更新日志 2026/03/03

最新

[Xiaomi MiMo Orbit 首批 Agent 生态共建合作伙伴公布](</docs/zh-CN/news/latest/v2.5-orbit>)

[MiMo-V2.5 系列调价公告丨 百万亿 Token 创造者激励计划收官](</docs/zh-CN/news/latest/v2.5-price-update>)

[小米 MiMo-V2.5 系列开源 & Orbit 百万亿 Token 计划启动](</docs/zh-CN/news/latest/v2.5-open-sourced>)

[Xiaomi MiMo-V2.5-TTS-Series + ASR 正式发布：你的声音，随心所“驭”](</docs/zh-CN/news/latest/v2.5-tts-release>)

[Xiaomi MiMo-V2.5 系列大模型开启公测](</docs/zh-CN/news/latest/v2.5-news>)

[Xiaomi MiMo 现已接入全球顶级 Agent 框架 Hermes Agent，并限免两周](</docs/zh-CN/news/latest/hermes-free>)

[Xiaomi MiMo Token Plan 正式发布](</docs/zh-CN/news/latest/token-plan-release>)

[Xiaomi MiMo Agent 框架调用限免活动延长一周](</docs/zh-CN/news/latest/free-trial-extension>)

[Xiaomi MiMo 联合全球顶级 Agent 框架开启首周限免](</docs/zh-CN/news/latest/first-week-free>)

[Xiaomi MiMo-V2-Pro 发布：面向 Agent 时代的旗舰基座](</docs/zh-CN/news/latest/v2-pro-release>)

[Xiaomi MiMo-V2-Omni 发布：看得清，听得懂，能动手的全模态 Agent 基座](</docs/zh-CN/news/latest/v2-omni-release>)

[Xiaomi MiMo-V2-TTS 发布：能说会唱的语音合成大模型](</docs/zh-CN/news/latest/v2-tts-release>)

往期新闻

[MiMo-V2-Flash 更新日志 2026/03/03](</docs/zh-CN/news/previous-news/news20260303>)

[MiMo-V2-Flash 更新日志 2026/02/04](</docs/zh-CN/news/previous-news/news20260212>)

[Xiaomi MiMo API 开放平台计费即将启动](</docs/zh-CN/news/previous-news/billing>)

[Xiaomi MiMo API 开放平台充值功能开放通知](</docs/zh-CN/news/previous-news/recharge>)

[MiMo-V2-Flash 更新日志 2026/01/12](</docs/zh-CN/news/previous-news/news20260112>)

[MiMo 模型公测限免延长公告](</docs/zh-CN/news/previous-news/beta-free>)

[MiMo-V2-Flash 发布 2025/12/16](</docs/zh-CN/news/previous-news/news20251216>)

邀请好友得体验金

# MiMo-V2-Flash 更新日志 2026/03/03

mimo-v2-flash 支持联网搜索，可获取实时公开信息（如新闻、商品、天气等）。

**核心能力**

  * **联网搜索方式灵活** ：支持强制搜索和意图识别两种方式，开通意图识别后，将自主判断是否进行联网搜索，无需手动触发。

  * **提前返回搜索来源** ：流式响应中，首包会返回所有搜索来源。

  * **多工具混合调用** ：可与自定义 Function、工具协同使用，模型会自动判断调用优先级与必要性。

  * **响应模式灵活** ：支持流式和非流式两种响应，两种方式都将返回搜索、总结内容。

**适用场景**

  * **实时新闻资讯整合**

    * 场景：用户询问“今天有哪些关于国产大模型的重要新闻？”

    * 能力：模型自动生成“国产大模型 最新动态 2026-03-01”等关键词进行搜索，并总结搜索结果回复用户，同时附上新闻来源链接。

  * **商品信息查询与比价**

    * 场景：用户询问“某品牌最新款手机的价格和用户评价怎么样？”

    * 能力：模型搜索获取多个电商平台的价格和评测信息，整理成简洁的摘要，帮助用户快速决策。

  * **即时天气与出行信息**

    * 场景：用户询问“明天上海的天气适合出门吗？”

    * 能力：模型搜索获取上海的天气预报，并结合常识给出出行建议，如“明日上海有雨，气温10-15℃，建议携带雨具，注意保暖”。

**使用说明与建议**

  1. **开启联网搜索** ：在使用前，先开通 [联网服务插件](<https://platform.xiaomimimo.com/#/console/plugin>)。详细参数及调用说明参见 [OpenAI API](<https://mimo.mi.com/#/docs/api/text-generation/openai-api>)。

  2. **费用** ：联网搜索功能会产生一定的Token 用于生成搜索词、处理搜索结果，同时我们将按联网工具调用次数收取一定的费用。详细说明见 [联网搜索](<https://mimo.mi.com/#/docs/usage-guide/tool-calling/web-search>)。

更新时间 2026 年 05 月 28 日

[Xiaomi MiMo-V2-TTS 发布：能说会唱的语音合成大模型](</docs/zh-CN/news/latest/v2-tts-release>)[MiMo-V2-Flash 更新日志 2026/02/04](</docs/zh-CN/news/previous-news/news20260212>)