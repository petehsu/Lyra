# CodeBuddy 配置

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

# CodeBuddy 配置

**按量付费的 MiMo API** 和 **Token Plan** 均支持 CodeBuddy，可参考本文进行配置与使用。

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
  
## 使用 CodeBuddy IDE

### 安装 CodeBuddy

访问 [CodeBuddy 官网](<https://www.codebuddy.cn/home/>) 下载并安装 IDE，支持主流操作系统（Windows、macOS）。

### 配置 MiMo 模型

**1.** **配置自定义模型**

创建或者修改配置文件 `models.json`，添加自定义模型，配置文件示例如下：

  * **macOS：**`~/.codebuddy/models.json`

  * **Windows：**`用户目录\.codebuddy\models.json`

`BASE_URL` 和 `MIMO_API_KEY` 需根据获取凭证的方式进行修改。
    
    
    {
      "models": [
        {
          "id": "mimo-v2.5-pro",
          "name": "mimo-v2.5-pro",
          "vendor": "MiMo",
          "apiKey": "MIMO_API_KEY",
          "url": "BASE_URL/chat/completions",
          "supportsToolCall": true,
          "supportsImages": false
        },
        {
          "id": "mimo-v2.5",
          "name": "mimo-v2.5",
          "vendor": "MiMo",
          "apiKey": "MIMO_API_KEY",
          "url": "BASE_URL/chat/completions",
          "supportsToolCall": true,
          "supportsImages": true
        }
      ]
    }
    

**2.** **查看和切换模型**

配置完成后，关闭 `Auto mode`，打开模型列表即可看到所配置的 MiMo 模型。

![图片](/static/VcysbSEXOodPojxZmYUca0Ysnzf.c366b89b.png)

### 使用 MiMo 模型

选择配置好的模型，即可进行对话、编码等操作。

![图片](/static/M09hbn0a8oGZk9xlbevcHmYtnbf.4f10d96b.png)

## 使用 CodeBuddy IDE 插件

### 安装插件

在 VS Code 扩展市场搜索 `Tencent Cloud CodeBuddy` 并安装插件。

![图片](/static/R8GsblAw3oOYjIxdnlxcvFb0nEh.1d638ef5.png)

### 配置 MiMo 模型

配置方式可参考“使用 CodeBuddy IDE”章节中的配置文件 `models.json`。如果之前已经配置过，将会自动读取配置。

![图片](/static/IJVlbaSj7oB0GNxP0yqcrl0Vnbf.9ea7f68e.png)

## 使用 CodeBuddy CLI

### 安装 CodeBuddy CLI

**通过 npm 安装（需先安装 Node.js 18.20 或更新版本）：**
    
    
    npm install -g @tencent-ai/codebuddy-code
    

**验证安装（如有版本号输出，则表示安装成功）：**
    
    
    codebuddy --version
    

### 配置 MiMo 模型

**按量付费的 MiMo API** 和 **Token Plan** 的 `BASE_URL` 和 `API Key` 是不相同，请按需配置。

配置方式可参考“使用 CodeBuddy IDE”章节中的配置文件 `models.json`。如果之前已经配置过，将会自动读取配置。

### 使用 CodeBuddy CLI

配置完成后，进入项目目录执行以下命令启动：
    
    
    codebuddy
    

启动后，通过 `/model` 查看模型列表或者切换模型，通过 `/status` 查看当前使用的模型。

## 常见问题

### 配置后模型没有出现在下拉菜单中？

  * 检查 JSON 语法是否正确

  * 如果配置了 `availableModels` 字段，确认模型 id 已包含在内

更新时间 2026 年 06 月 12 日

[Qwen Code 配置](</docs/zh-CN/tokenplan/integration/qwencode>)[Cline 配置](</docs/zh-CN/tokenplan/integration/cline>)