# Cline 配置

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

# Cline 配置

**按量付费的 MiMo API** 和 **Token Plan** 均支持 Cline，可参考本文进行配置与使用。

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
  
## 使用 Cline CLI

### 安装 Cline CLI

**前置要求：** 需安装 Node.js 20 或更高版本（推荐 Node.js 22）。

**安装命令：**
    
    
    npm install -g cline
    

**验证安装（如有版本号输出，则表示安装成功）：**
    
    
    cline --version
    

### 配置基本信息

Cline CLI 通过 `cline auth` 命令配置 API 提供商，执行以下命令完成 MiMo 模型配置：
    
    
    cline auth -p openai -k MIMO_API_KEY -b BASE_URL -m mimo-v2.5-pro
    

参数说明：

  * `-p openai`：选择 OpenAI 兼容供应商

  * `-k`：填写对应使用方式获取的 API Key

  * `-b`：填写对应使用方式获取的 BASE_URL

  * `-m`：填写模型ID，如 `mimo-v2.5-pro`

更多详细配置信息可访问 [Cline CLI 官方文档](<https://docs.cline.bot/cline-cli/cli-reference>)。

也可通过交互式向导配置，直接执行 `cline auth` 按提示操作即可。

### 使用 Cline CLI

以上配置完成后，新建一个终端，执行以下命令启动 Cline CLI。

> 如果习惯了旧版终端操作，选择 `Exit` 后，执行 `cline --tui` 就能回到熟悉的命令行环境。
    
    
    cline
    

启动以后，即可在 Cline CLI 使用 MiMo 模型。

## 使用 Cline IDE 插件

### 安装插件

在 VS Code 扩展市场搜索并安装 **Cline** 插件。

![图片](/static/FvQQbOCZuodvFOxEFAacNBNBnnd.957b5384.png)

### 配置基本信息

在 VS Code 中打开 Cline 插件，按照以下配置填写相关信息：

  * 必填配置：

  * **API Provider** ：选择 `OpenAI Compatible`

  * **Base URL** ：填写对应使用方式获取的 BASE_URL

  * **API Key** ：从对应使用方式获取的 API Key

  * **Model ID** ：填写模型名称，如 `mimo-v2.5-pro`

  * 选填配置：

  * 取消勾选 **Supports Images**

  * **Context Window Size** 设置为 `1048576`

  * **Temperature** 设置为 `1.0`，可根据任务需求进行调整

其他未提及参数可根据需求进行调整。

### 使用 Cline 插件

配置成功后，可在输入框中输入需求，例如生成代码：

![图片](/static/S0uTbeh7foFjZRxk2bkcZFZvnyh.e09947a4.png)

更新时间 2026 年 06 月 12 日

[CodeBuddy 配置](</docs/zh-CN/tokenplan/integration/codebuddy>)[Xiaomi MiMo Orbit 首批 Agent 生态共建合作伙伴公布](</docs/zh-CN/news/latest/v2.5-orbit>)