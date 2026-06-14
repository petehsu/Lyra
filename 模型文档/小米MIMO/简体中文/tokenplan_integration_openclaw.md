# OpenClaw 配置

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

# OpenClaw 配置

**按量付费的 MiMo API** 和 **Token Plan** 均支持在 OpenClaw 中使用，可参考本文进行配置与使用。

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
  
注：OpenClaw 在 Anthropic 协议下使用 MiMo 由于包含工具调用的 assistant 中缺失 `reasoning_content`，API 会返回 400 报错，详见 [【重要公告】关于 Agent 类产品多轮会话中回传 reasoning_content 的说明](<https://mimo.mi.com/docs/zh-CN/usage-guide/passing-back-reasoning_content>) 。

## 安装 OpenClaw

前置条件：[Node.js 22 或更新版本](<https://nodejs.org/en/download/>)

macOS/Linux：
    
    
    curl -fsSL https://openclaw.ai/install.sh | bash
    

Windows (PowerShell)：
    
    
    iwr -useb https://openclaw.ai/install.ps1 | iex
    

![图片](/static/KhhxbbIR3oBtqsxefe8cLWA4nZf.ff18cff3.png)

## 配置和使用 MiMo 模型

**注意事项：** **OpenClaw 支持 MiMo 按量付费 API 的预置配置，可通过方法 1 交互式配置向导进行配置。** **OpenClaw 还未添加 MiMo Token Plan 预置配置，需要通过方法 2 手动修改配置文件。**

### 方法1：交互式配置向导

安装完成后，将自动开始配置过程。您也可以运行以下命令开始配置：
    
    
    openclaw onboard --install-daemon
    

**1\. 配置供应商**

![图片](/static/BJ3Eb7R90ongELxWcoxcAmsenWg.c5a1efc1.png)

![图片](/static/G338bo0CMoIlFdxAEgMc2SuDn0b.5816bedf.png)

  * 我理解 OpenClaw 默认面向个人使用；共享/多用户使用需要加固? ➡️ Yes

  * 设置模式 ➡️ QuickStart

  * 配置处理 ➡️ 查看并更新

  * Model/auth provider ➡️ Xiaomi

**2.** **配置模型和 API Key**

![图片](/static/Reakb6HploxqK3x75SYcmg2Nndg.c09d367f.png)

  * 输入 MiMo 开放平台的 API Key，浏览所有模型，可选择最新的 v 2.5 系列模型。

**3.** **继续完成后续配置**

  * 选择频道、选择搜索提供方、配置技能等

  * 完成设置

**4.** **测试机器人**

  * How do you want to hatch your bot? ➡️ 可在 TUI/Web UI 中和机器人对话

    * TUI：输入 `openclaw tui`，若成功对话则表示配置成功

![图片](/static/PXzSbarKLo5UiWxmYvecTiomnec.d8d8395a.png)

  * Web UI：通过打开终端中显示的 `Web UI (with token)` 链接来访问 Web UI

![图片](/static/QrUTbLvuXoPhqBxmmHFcA0xJnae.f00dcf47.png)

![图片](/static/T0R8bpzoboUG62x6mtecVi1Tnlb.ca3ca29c.png)

### 方法2：修改配置文件

将以下内容完整复制到配置文件 `~/.openclaw/openclaw.json` 中（实际使用时按需更换 BASE_URL 和 API Key）：

**注意事项：Token Plan 仅支持通过方法 2 配置，使用 Token Plan 时需要删除配置文件中** `"auth"` **字段，且需要新增 provider 和预置的 MiMo 网关区分。**

**Token Plan** **配置示例：**

**删除配置文件中** `"auth"` **字段**
    
    
     "auth": {
        "profiles": {
          "xiaomi:default": {
            "provider": "xiaomi",
            "mode": "api_key"
          }
        }
      }
    

在 models.provider 路径下新增 provider，provider 名字不要设为 `xiaomi` ，和预置的 MiMo 网关区分，例如设为 `xiaomi-coding`

对应的默认的 agent 的配置也要增加对应的模型，格式是 `provider名称/模型名称` ，例如`xiaomi-coding/mimo-v2.5-pro`
    
    
    {
      "models": {
        "mode": "merge",
        "providers": {
          "xiaomi-coding": {
            "baseUrl": "BASE_URL",
            "apiKey": "API_KEY",
            "api": "openai-completions",
            "models": [
              {
                "id": "mimo-v2.5-pro",
                "name": "mimo-v2.5-pro",
                "reasoning": true,
                "input": [
                  "text"
                ],
                "contextWindow": 1048576,
                "maxTokens": 32000
              },
              {
                "id": "mimo-v2.5",
                "name": "mimo-v2.5",
                "reasoning": true,
                "input": [
                  "text",
                  "image"
                ],
                "contextWindow": 262144,
                "maxTokens": 32000
              }
            ]
          }
        }
      },
      "agents": {
        "defaults": {
          "model": {
            "primary": "xiaomi-coding/mimo-v2.5-pro"
          },
          "models": {
            "xiaomi-coding/mimo-v2.5": {},
            "xiaomi-coding/mimo-v2.5-pro": {}
          }
        }
      }
    }
    

**按量付费 API 配置示例**
    
    
     {
       "auth": {
        "profiles": {
          "xiaomi:default": {
            "provider": "xiaomi",
            "mode": "api_key"
          }
        }
      },
      "models": {
        "mode": "merge",
        "providers": {
          "xiaomi": {
            "baseUrl": "BASE_URL",
            "apiKey": "API_KEY",
            "api": "openai-completions",
            "models": [
              {
                "id": "mimo-v2.5-pro",
                "name": "mimo-v2.5-pro",
                "reasoning": true,
                "input": [
                  "text"
                ],
                "contextWindow": 1048576,
                "maxTokens": 32000
              },
              {
                "id": "mimo-v2.5",
                "name": "mimo-v2.5",
                "reasoning": true,
                "input": [
                  "text",
                  "image"
                ],
                "contextWindow": 262144,
                "maxTokens": 32000
              }
            ]
          }
        }
      },
      "agents": {
        "defaults": {
          "model": {
            "primary": "xiaomi/mimo-v2.5-pro"
          },
          "models": {
            "xiaomi/mimo-v2.5": {},
            "xiaomi/mimo-v2.5-pro": {}
          }
        }
      }
    }
    

## 接入更多渠道

OpenClaw 提供了更多渠道供您与机器人交互，如 Web UI、Discord、飞书等，可参考官方文档来设置这些渠道：[Chat Channels - OpenClaw](<https://docs.openclaw.ai/channels>)。

## 常见问题

### 为什么使用 OpenClaw 交互式配置时，模型列表中没有找到 `mimo-v2-pro` 和 `mimo-v2-omni`？

`mimo-v2-pro` 和 `mimo-v2-omni` 已更新至 OpenClaw 2026.3.19 及之后的版本，请更新版本后再试。

更新时间 2026 年 06 月 12 日

[Claude Code 配置](</docs/zh-CN/tokenplan/integration/claudecode>)[Hermes Agent 配置](</docs/zh-CN/tokenplan/integration/hermes-agent>)