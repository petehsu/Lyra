# Claude Code 配置

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

# Claude Code 配置

**按量付费的 MiMo API** 和 **Token Plan** 均支持 Claude Code，可参考本文进行配置与使用。

## 前置工作

### 获取凭证

支持两种使用方式，但对应的凭证获取方式不同：

使用方式 | 说明 | 获取方式（以下为 BASE_URL 和 API Key 均为示例）  
---|---|---  
按量付费 API 调用 | 按实际使用量计费，适合轻度使用 | 

  * BASE_URL
    * Anthropic 兼容协议：`https://api.xiaomimimo.com/anthropic`
  * API Key
    * 格式：`sk-xxxxx`

  
前往 [API Keys](<https://platform.xiaomimimo.com/#/console/api-keys>) 创建 API Key  
Token Plan | 固定订阅费，按套餐限量调用 | 

  * BASE_URL
    * Anthropic 兼容协议：`https://token-plan-cn.xiaomimimo.com/anthropic`
  * API Key
    * 格式：`tp-xxxxx`

  
成功订阅后，前往 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 获取专属 Base URL 和 API Key  
  
## 使用 Claude Code CLI

### 安装 Claude Code CLI

Claude Code 依赖 Node.js 18 或更新版本。

  * Linux/MacOS 系统不需额外操作，默认环境即可。

  * Windows 系统需要参考 [Windows 系统安装 WSL](<https://learn.microsoft.com/en-us/windows/wsl/install>) 安装 WSL 或 参考 [Windows 系统安装 Git for Windows](<https://git-scm.com/install/windows>) 安装 Git for Windows，然后在 WSL 或 Git Bash 中执行下方命令。

**安装命令：**
    
    
    npm install -g @anthropic-ai/claude-code
    

**验证安装（如有版本号输出，则表示安装成功）：**
    
    
    claude --version
    

安装成功后先不要直接使用 claude 命令启动，需先完成下方配置。

### 配置基本信息

配置前，请确保已清除以下 Anthropic 官方相关环境变量，以免影响 API 正常使用：`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`

**1.** **创建/编辑** `settings.json`

> 如果 `.claude` 目录不存在，用户可自己创建。

  * macOS/Linux：`~/.claude/settings.json`

  * Windows：`用户目录/.claude/settings.json`

请按需更换 `BASE_URL`（Anthropic 兼容协议） 和 `MIMO_API_KEY`。

对于支持 **1M** 上下文的 MiMo 模型，可以在模型 ID 后加上 `[1m]` 后缀以扩展上下文，例如：`mimo-v2.5-pro[1m]`。配置完成后重启 Claude Code，执行 `/context` 命令即可校验长上下文是否生效。
    
    
    {
      "env": {
        "ANTHROPIC_BASE_URL": "BASE_URL",
        "ANTHROPIC_AUTH_TOKEN": "MIMO_API_KEY",
        "ANTHROPIC_MODEL": "mimo-v2.5-pro",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "mimo-v2.5-pro",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "mimo-v2.5-pro",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "mimo-v2.5-pro"
      }
    }
    

**2.** **创建/编辑** `.claude.json`

  * macOS/Linux：`~/.claude.json`

  * Windows：`用户目录/.claude.json`

    
    
    {
      "hasCompletedOnboarding": true
    }
    

**3.** **使配置生效**

配置完成后，**重新打开终端窗口** 使配置生效。

### 使用 Claude Code CLI

进入项目目录，执行：
    
    
    claude
    

首次启动需完成以下操作：选择"**信任此文件夹 (Trust This Folder)** "，允许 Claude Code 访问项目文件。启动后可通过 `/status` 命令确认当前配置和模型状态。

## 使用 Claude Code IDE 插件

Claude Code 提供 VS Code IDE 的插件支持，配置时也可参考官方使用文档 [Use Claude Code in VS Code](<https://code.claude.com/docs/en/vs-code#vs-code-extension-vs-claude-code-cli>)。

### 安装插件

在 VS Code 扩展市场搜索并安装 **Claude Code for VS Code** 插件。

![图片](/static/ZvXPbOO07oZwgHxfcgiceBftnke.e55c2958.png)

### 配置模型

打开 VS Code 设置，搜索 `Claude Code: Environment Variables`，然后在 `settings.json` 中手动配置：
    
    
    {
      "claudeCode.preferredLocation": "panel",
      "claudeCode.selectedModel": "mimo-v2.5-pro",
      "claudeCode.environmentVariables": [
        {
          "name": "ANTHROPIC_BASE_URL",
          "value": "BASE_URL"
        },
        {
          "name": "ANTHROPIC_AUTH_TOKEN",
          "value": "MIMO_API_KEY"
        },
        {
          "name": "ANTHROPIC_DEFAULT_SONNET_MODEL",
          "value": "mimo-v2.5-pro"
        },
        {
          "name": "ANTHROPIC_DEFAULT_OPUS_MODEL",
          "value": "mimo-v2.5-pro"
        },
        {
          "name": "ANTHROPIC_DEFAULT_HAIKU_MODEL",
          "value": "mimo-v2.5-pro"
        }
      ]
    }
    

若已安装 Claude Code CLI，VS Code 插件会自动复用 CLI 的配置。如需独立配置，按上述方式在插件设置中指定环境变量。

## 常见问题

### Windows 下安装报错？

确保已安装以下依赖：

  * Node.js 18+

  * Git for Windows

如使用 npm 安装遇到权限问题，可尝试以管理员身份运行终端，或使用 nvm 管理 Node.js 版本。

更新时间 2026 年 06 月 12 日

[OpenCode 配置](</docs/zh-CN/tokenplan/integration/opencode>)[OpenClaw 配置](</docs/zh-CN/tokenplan/integration/openclaw>)