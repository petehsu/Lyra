# Cherry Studio 配置

Token Plan

[订阅说明](</docs/zh-CN/tokenplan/Token Plan/subscription>)

[快速接入](</docs/zh-CN/tokenplan/Token Plan/quick-access>)

集成扩展

[AI 工具总览](</docs/zh-CN/tokenplan/integration/tools-overview>)

[MiMo Code 配置](</docs/zh-CN/tokenplan/integration/mimo-code>)

[OpenCode 配置](</docs/zh-CN/tokenplan/integration/opencode>)

[Claude Code 配置](</docs/zh-CN/tokenplan/integration/claudecode>)

[OpenClaw 配置](</docs/zh-CN/tokenplan/integration/openclaw>)

[Hermes Agent 配置](</docs/zh-CN/tokenplan/integration/hermes-agent>)

[Kilo Code 配置](</docs/zh-CN/tokenplan/integration/kilocode>)

[Cherry Studio 配置](</docs/zh-CN/tokenplan/integration/cherrystudio>)

[Qwen Code 配置](</docs/zh-CN/tokenplan/integration/qwencode>)

[CodeBuddy 配置](</docs/zh-CN/tokenplan/integration/codebuddy>)

[Cline 配置](</docs/zh-CN/tokenplan/integration/cline>)

邀请好友得体验金

# Cherry Studio 配置

**按量付费的 MiMo API** 和 **Token Plan** 均支持 Cherry Studio，可参考本文进行配置与使用。

## 前置工作

### 获取凭证

支持两种使用方式，但对应的凭证获取方式不同：

使用方式 | 说明 | 获取方式（以下为 BASE_URL 和 API Key 均为示例）  
---|---|---  
按量付费 API 调用 | 按实际使用量计费，适合轻度使用 | 

  * BASE_URL
    * OpenAI 兼容协议：`https://api.xiaomimimo.com/v1`
  * API Key
    * 格式：`sk-xxxxx`

  
前往 [API Keys](<https://platform.xiaomimimo.com/#/console/api-keys>) 创建 API Key  
Token Plan | 固定订阅费，按套餐限量调用 | 

  * BASE_URL
    * OpenAI 兼容协议：`https://token-plan-cn.xiaomimimo.com/v1`
  * API Key
    * 格式：`tp-xxxxx`

  
成功订阅后，前往 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 获取专属 Base URL 和 API Key  
  
## 安装 Cherry Studio

Cherry Studio 是一款桌面 AI 客户端，支持多模型对话。

  * 官网下载：<https://www.cherry-ai.com>

  * Github 地址：<https://github.com/CherryHQ/cherry-studio>

## 配置基本信息

**1.** **查找供应商** `Xiaomi MiMo`

点击右上角设置图标，进入模型服务页面，在搜索框中搜索 `Xiaomi MiMo`。

![图片](/static/DjSEbYMCnodgZyxLOIocuwEonqb.e76a8b5a.png)

**2.** **配置基本信息**

**普通 API 调用**

由于 `Xiaomi MiMo` 模型服务已经由 Cherry Studio 官方提供，所以这里仅需要提供该方式获取的 API Key 即可，API Host 保持不变。

![图片](/static/UBelbrppAoggGMxuohQc3Usingz.d2364207.png)

**Token Plan**

当成功订阅 Token Plan 后，需要替换为 Token Plan 专属的 API Key 和 API Host（BASE_URL）。

注意：Agent 模式下暂时无法使用 Token Plan。

## 使用 Cherry Studio

在模型列表中选择需要使用的模型，即可正常对话。

![图片](/static/Ixmzbj16uoc3wZxSS95cXWVRnbg.fb047d2e.png)

### 开启思考模式（可选）

点击助手设置，添加自定义参数：`"thinking": {"type": "enabled"}`。

也可根据需求，设置温度、上下文等其他参数。

![图片](/static/Z804btAvbojS7ax78Ofczv8ynHd.9ada74f5.png)

![图片](/static/Gf39bJgXpok9yxx02OZcRmfan9t.1ada8548.png)

更新时间 2026 年 06 月 12 日

[Kilo Code 配置](</docs/zh-CN/tokenplan/integration/kilocode>)[Qwen Code 配置](</docs/zh-CN/tokenplan/integration/qwencode>)