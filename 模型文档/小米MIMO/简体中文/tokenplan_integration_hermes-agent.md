# Hermes Agent 配置

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

# Hermes Agent 配置

**按量付费的 MiMo API** 和 **Token Plan** 支持 Hermes Agent，可参考本文进行配置与使用。

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
  
## 安装 Hermes Agent

Hermes Agent 支持 Linux、macOS、WSL2（Windows）等系统，如需了解更多内容，可参考 [Hermes Agent 官方文档](<https://hermes-agent.nousresearch.com/docs/>)。

  * Linux / macOS 系统不需额外操作，默认环境即可。

  * Windows 系统需要参考 [Windows 系统安装 WSL](<https://learn.microsoft.com/en-us/windows/wsl/install>) 安装 WSL2，然后在 WSL2 中执行下方命令。

**安装命令：**
    
    
    curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
    

**安装完成后，重新加载终端环境：**
    
    
    source ~/.bashrc   # or source ~/.zshrc
    

**验证安装（如有版本号输出，则表示安装成功）：**
    
    
    hermes --version
    

安装完成后出现以下界面：

![图片](/static/G3tsb94DIoWEiqxiwQecP6TdnXd.9163fed1.png)

## 配置预定义供应商

**1.** **选择快速设置**

初次配置时可选择 Quick setup，进行快速配置。

> 如果一开始未配置也可通过 `hermes setup` 重新进入向导页面进行配置。

![图片](/static/VTzgbEbzgowoNVxhtlGcA4aAnhb.f7fcc624.png)

**2.** **选择供应商** `Xiaomi MiMo`

![图片](/static/NoTmbbUghoxDLCx4uK9c6aP1nId.d238505b.png)

**3.** **填写配置信息**

根据引导设置 API Key，Base URL，默认模型。其中，API Key 和 Base URL 需根据获取凭证的方式进行填写。

![图片](/static/YmF6bMISMolQGbx1CgVcAf2vnGf.0dd9b8a9.png)

后续其他步骤按需配置即可。

**如果以前已经配置过按量付费的 MiMo API 的 API Key 和 Base URL，现需切换为 Token Plan**

  * **方法一：** 编辑 `~/.hermes/.env` 文件，将 `XIAOMI_API_KEY` 和 `XIAOMI_BASE_URL` 更换为 Token Plan 专属的 API Key 和 Base URL 即可（配置完成后打开新终端）。
  * **方法二：** 使用自定义供应商进行配置。

**4.** **配置完成后，将会出现以下界面**

![图片](/static/AP27b3OWRofwA8xWjS2c9E9Cn6d.06e033b7.png)

## 配置自定义供应商

### 配置基本信息

下面两种配置方式中的 `BASE_URL` 和 `MiMo_API_KEY` 需替换为实际获取的。

**方式一：在终端输入以下命令快速配置**

这里的 `model.provider` 只能设置为 `custom`，自定义其他名称将不合法，比如 `xiaomi-coding`。
    
    
    hermes config set model.provider custom
    hermes config set model.base_url BASE_URL
    hermes config set model.api_key MIMO_API_KEY
    hermes config set model.default mimo-v2.5-pro
    

配置完毕后，可在 `~/.hermes/config.yaml` 中查看配置信息。

**方式二：手动编辑配置文件**

手动编辑 `~/.hermes/config.yaml` 进行配置：
    
    
    model:
      provider: custom
      base_url: BASE_URL
      api_key: MIMO_API_KEY
      default: mimo-v2.5-pro
    

### 验证配置

配置完成后，使用以下命令验证：
    
    
    hermes doctor
    

## 使用 Hermes Agent

配置完成后，执行以下命令启动：
    
    
    hermes            # 经典 CLI 模式
    hermes --tui      # 现代 TUI 模式
    

更新时间 2026 年 06 月 12 日

[OpenClaw 配置](</docs/zh-CN/tokenplan/integration/openclaw>)[Kilo Code 配置](</docs/zh-CN/tokenplan/integration/kilocode>)