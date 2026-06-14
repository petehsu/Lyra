# 快速接入

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

# 快速接入

本文介绍如何快速接入 Token Plan，从订阅到调用，仅需 3 步即可完成。

## 步骤一：订阅 Token Plan

前往 [Token Plan](<https://platform.xiaomimimo.com/#/token-plan>)，选择适合的订阅套餐。

## 步骤二：获取凭证

订阅成功后，前往 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 获取以下凭证：

  * **API Key** ：在 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 页面，获取专属 API Key（格式为 `tp-xxxxx`）。

  * **Base URL** ：后续需在 AI 编程工具中配置以下其中一个Base URL（ **协议因工具而异，Base URL 以** [**Token Plan**](<https://platform.xiaomimimo.com/#/console/plan-manage>) **页面展示为准** ），具体操作请参见对应的 AI 编程工具使用指南文档。

    * **OpenAI 兼容协议**

      * 中国集群：`https://token-plan-cn.xiaomimimo.com/v1`

      * 新加坡集群：`https://token-plan-sgp.xiaomimimo.com/v1`

      * 欧洲集群：`https://token-plan-ams.xiaomimimo.com/v1`

    * **Anthropic 兼容协议**

      * 中国集群：`https://token-plan-cn.xiaomimimo.com/anthropic`

      * 新加坡集群：`https://token-plan-sgp.xiaomimimo.com/anthropic`

      * 欧洲集群：`https://token-plan-ams.xiaomimimo.com/anthropic`

Token Plan 的 API Key（`tp-xxxxx`）与按量付费 API 调用的 API Key（`sk-xxxxx`）相互独立，不可混用。

## 步骤三：接入 AI 编程工具

前往 [AI 工具总览](<https://mimo.mi.com/#/docs/integration/tools-overview>) 查看您所使用工具（如 OpenCode、OpenClaw 等）对应的配置指南。

## 快速验证（可选）

完成配置后，可通过以下方式快速验证是否接入成功。

### 方式一：通过 AI 编程工具验证

在已配置好的 AI 编程工具中输入一段简单的编程需求，例如：

> 帮我用 Python 写一个快速排序算法

如果工具正常返回代码，则说明接入成功。

### 方式二：通过 API 直接调用验证

使用 curl 命令直接调用 API，验证凭证是否有效。

以下示例中的 `BASE_URL` 和 `MIMO_API_KEY` 均为占位符，实际使用时请替换为从控制台获取的真实凭证。

**OpenAI 兼容协议：**
    
    
    curl --location --request POST 'BASE_URL/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "model": "mimo-v2.5-pro",
        "messages": [
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": "please introduce yourself"
            }
        ],
        "max_completion_tokens": 1024
    }'
    

**Anthropic 兼容协议：**
    
    
    curl --location --request POST 'BASE_URL/v1/messages' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "model": "mimo-v2.5-pro",
        "max_tokens": 1024,
        "system": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024.",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "please introduce yourself"
                    }
                ]
            }
        ]
    }'
    

## 常见问题

**问题：Token Plan 的 API Key 和按量付费 API 调用的 API Key 有什么区别？**

回答：Token Plan 的 API Key 格式为 `tp-xxxxx`，仅用于 Token Plan 订阅服务；按量付费 API 调用的 API Key 格式为 `sk-xxxxx`，用于按量计费。两者相互独立，不可混用。

**问题：Token Plan 的 Base URL 和按量付费 API 调用的 Base URL 有什么区别？**

回答：Token Plan 的 Base URL 格式不同，以 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 页面展示为准。

**问题：订阅到期后，API Key 还能使用吗？**

回答：不能。Token Plan 的 API Key 仅在订阅有效期内可用，订阅到期后需要续费才能继续使用。