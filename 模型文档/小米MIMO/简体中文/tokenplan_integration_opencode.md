# OpenCode 配置

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

# OpenCode 配置

**按量付费的 MiMo API** 和 **Token Plan** 均支持 OpenCode，可参考本文进行配置与使用。

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
  
注：OpenCode 在 Anthropic 协议下使用 MiMo 由于包含工具调用的 assistant 中缺失 `reasoning_content`，API 会返回 400 报错，详见 [【重要公告】关于 Agent 类产品多轮会话中回传 reasoning_content 的说明](<https://mimo.mi.com/docs/zh-CN/usage-guide/passing-back-reasoning_content>) 。

## 使用 OpenCode CLI

### 安装 OpenCode CLI

OpenCode 支持两种安装方式。

**方式一：官方脚本安装（适用于 macOS/Linux）**
    
    
    curl -fsSL https://opencode.ai/install | bash
    

**方式二：npm 安装**

需先安装 Node.js 18 或更新版本。
    
    
    npm install -g opencode-ai
    

**验证安装（如有版本号输出，则表示安装成功）：**
    
    
    opencode -v
    

### 配置基本信息

编辑或新建 `opencode.json` 配置文件，具体路径如下：

  * **macOS/Linux** ：`~/.config/opencode/opencode.json`

  * **Windows** ：`用户目录\.config\opencode\opencode.json`

将以下内容完整复制到配置文件中（实际使用时按需更换 `BASE_URL` 和 `MIMO_API_KEY`）：
    
    
    {
      "$schema": "https://opencode.ai/config.json",
      "provider": {
        "mimo": {
          "npm": "@ai-sdk/openai-compatible",
          "name": "MiMo",
          "options": {
            "baseURL": "BASE_URL",
            "apiKey": "MIMO_API_KEY"
          },
          "models": {
            "mimo-v2.5-pro": {
              "name": "mimo-v2.5-pro",
              "limit": {
                "context": 1048576,
                "output": 131072
              },
              "modalities": {
                "input": [
                  "text"
                ],
                "output": [
                  "text"
                ]
              }
            },
            "mimo-v2.5": {
              "name": "mimo-v2.5",
              "limit": {
                "context": 1048576,
                "output": 131072
              },
              "modalities": {
                "input": [
                  "text", "image"
                ],
                "output": [
                  "text"
                ]
              }
            }
          }
        }
      }
    }
    

**注意事项：** 如果需要开启图片理解能力，需要在支持该能力的模型（如：`mimo-v2.5`）的配置节点下修改或新增如下配置项，即在支持的输入模态中增加 `image`：`"modalities": {"input": ["text", "image"], "output": ["text"]}`

### 使用 OpenCode CLI

以上配置完成后，进入项目目录，执行以下命令启动 OpenCode：
    
    
    opencode
    

启动以后，输入 `/models` 可查看和切换使用的模型。

## 使用 OpenCode IDE 插件

### 安装插件

在 VS Code 扩展市场搜索并安装 **opencode** 插件。

![图片](/static/IhkObg9SyoUZ7DxXJrXcrliRn4e.c810f63a.png)

### 配置预定义供应商（推荐）

在输入框中输入 `/connect`，搜索 `Xiaomi`，选择对应的 Provider，填写 API Key 即可。

使用 **Xiaomi Token Plan** 时，需要选择与 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 页面展示的 Base URL 对应的 `Provider`。

  * `https://token-plan-cn.xiaomimimo.com/*`：Xiaomi Token Plan (China)
  * `https://token-plan-sgp.xiaomimimo.com/*`：Xiaomi Token Plan (Singapore)
  * `https://token-plan-ams.xiaomimimo.com/*`：Xiaomi Token Plan (Europe)

![图片](/static/FfTYbqCeNoNmF2xArnEcp5CknQf.fa7a239f.png)

### 配置自定义供应商

可参考 OpenCode CLI 中“配置基本信息”的步骤进行配置。

### 使用 OpenCode 插件

![图片](/static/DAzFbpY5MouRJvxwuZ6cBs42nXS.1f0f0e0c.png)

## 常见问题

### 在 Windows 系统验证安装时，遇到如下报错，如何解决？

> It seems that your package manager failed to install the right version of the opencode CLI for your platform. You can try manually installing "opencode-windows-x64" or "opencode-windows-x64-baseline" package

回答： 按照提示执行命令 `npm install -g opencode-windows-x64` 即可解决。

### 在 Windows 上的 VS Code 中启动 OpenCode 描述时报错？

> opencode : 无法加载文件 ... 因为在此系统上禁止运行脚本

回答： 将 VS Code 里打开终端时，默认启动的终端类型改为 Git Bash。

![图片](/static/J1Gmbadg4oGNUUxKoP7ch1PJnze.203379e3.png)

更新时间 2026 年 06 月 12 日

[MiMo Code 配置](</docs/zh-CN/tokenplan/integration/mimo-code>)[Claude Code 配置](</docs/zh-CN/tokenplan/integration/claudecode>)