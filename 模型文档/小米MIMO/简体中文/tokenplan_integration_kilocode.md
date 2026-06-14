# Kilo Code 配置

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

# Kilo Code 配置

**按量付费的 MiMo API** 和 **Token Plan** 均支持 Kilo Code，可参考本文进行配置与使用。

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
  
注：Kilo Code 在 Anthropic 协议下使用 MiMo 由于包含工具调用的 assistant 中缺失 `reasoning_content`，API 会返回 400 报错，详见 [【重要公告】关于 Agent 类产品多轮会话中回传 reasoning_content 的说明](<https://mimo.mi.com/docs/zh-CN/usage-guide/passing-back-reasoning_content>) 。

## 使用 Kilo Code CLI

### 安装 Kilo Code CLI

需先安装 Node.js 18 或更新版本。

**安装命令：**
    
    
    npm install -g @kilocode/cli
    

**验证安装（如有版本号输出，则表示安装成功）：**
    
    
    kilocode --version
    

### 配置基本信息

编辑或新建 `config.json` 配置文件，具体路径如下：

  * **macOS/Linux** ：`~/.config/kilo/config.json`

  * **Windows** ：`用户目录\.config\kilo\config.json`

将以下内容完整复制到配置文件中（实际使用时按需更换 `BASE_URL` 和 `MIMO_API_KEY`）：
    
    
    {
      "$schema": "https://kilo.ai/config.json",
      "disabled_providers": [],
      "provider": {
        "mimo": {
          "name": "MiMo",
          "npm": "@ai-sdk/openai-compatible",
          "models": {
            "mimo-v2.5-pro": {
              "name": "mimo-v2.5-pro",
              "options": {
                "thinking": {
                  "type": "enabled"
                }
              }
            }
          },
          "options": {
            "apiKey": "MIMO_API_KEY",
            "baseURL": "BASE_URL"
          }
        }
      },
      "permission": {
        "bash": "allow"
      }
    }
    

更多详细配置信息可访问 [Kilo Code CLI 官方文档](<https://kilo.org.cn/docs/cli>)。

### 使用 Kilo Code CLI

以上配置完成后，新建一个终端，执行以下命令启动 Kilo Code CLI。
    
    
    kilocode
    

启动以后，输入 `/models` 切换模型，即可在 Kilo Code CLI 使用 MiMo 模型。

## 使用 Kilo Code IDE 插件

### 安装插件

在 VS Code 扩展市场搜索并安装 **Kilo Code** 插件。

![图片](/static/By1Tb5uObodws3xpQfDcau5Inlh.0a25ef3a.png)

### 配置预定义供应商（推荐）

点击 Providers --> Show more providers，搜索 `Xiaomi`，选择对应的 Provider，填写 API Key 即可。

使用 **Xiaomi Token Plan** 时，需要选择与 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 页面展示的 Base URL 对应的 `Provider`。

  * `https://token-plan-cn.xiaomimimo.com/*`：Xiaomi Token Plan (China)
  * `https://token-plan-sgp.xiaomimimo.com/*`：Xiaomi Token Plan (Singapore)
  * `https://token-plan-ams.xiaomimimo.com/*`：Xiaomi Token Plan (Europe)

![图片](/static/WiEVb4NHPoVoJVxhzkQc5kK2nVb.85a1b09e.png)

### 配置自定义供应商

按照以下配置填写相关信息。

**1.** **选择 Custom Provider**

![图片](/static/OepxbqzeroHpwVxxYIhc2tpSn74.f3751fb8.png)

**2.** **填写配置信息**

  * **Provider ID** 和 **Display name** ：根据自己需求填写

  * **Base URL** ：填写对应使用方式获取的 BASE_URL

  * **API Key** ：从对应使用方式获取的 API Key

  * **Models** ：按照需求添加，如 `mimo-v2.5-pro`

![图片](/static/QzrZbB2d8owpYZxoTD4cOEzYnZd.56106c7f.png)

其他未提及参数可根据需求进行调整。

### 使用 Kilo Code 插件

配置成功后，切换到配置的模型，可在输入框中输入需求即可使用。

![图片](/static/I6cRb8dZ7oPXpWxm2GdcZnwqn8g.ad551dff.png)

## 常见问题

### 在 Windows 系统验证安装时，遇到如下报错，如何解决？

> It seems that your package manager failed to install the right version of the Kilo CLI for your platform. You can try manually installing "@kilocode/cli-windows-x64" or "@kilocode/cli-windows-x64-baseline" package

按照提示执行命令 `npm install -g @kilocode/cli-windows-x64` 即可解决。

更新时间 2026 年 06 月 12 日

[Hermes Agent 配置](</docs/zh-CN/tokenplan/integration/hermes-agent>)[Cherry Studio 配置](</docs/zh-CN/tokenplan/integration/cherrystudio>)