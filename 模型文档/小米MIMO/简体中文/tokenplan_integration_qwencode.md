# Qwen Code 配置

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

# Qwen Code 配置

**按量付费的 MiMo API** 和 **Token Plan** 均支持 Qwen Code，可参考本文进行配置与使用。

## 前置工作

### 获取凭证

支持两种使用方式，但对应的凭证获取方式不同：

使用方式 | 说明 | 获取方式（以下为 BASE_URL 和 API Key 均为示例）  
---|---|---  
按量付费 API 调用 | 按实际使用量计费，适合轻度使用 | 

  * BASE_URL
    * OpenAI 兼容协议：`https://api.xiaomimimo.com/v1`
    * Anthropic 兼容协议：`https://api.xiaomimimo.com/anthropic`
  * API Key
    * 格式：`sk-xxxxx`

  
前往 [API Keys](<https://platform.xiaomimimo.com/#/console/api-keys>) 创建 API Key  
Token Plan | 固定订阅费，按套餐限量调用 | 

  * BASE_URL
    * OpenAI 兼容协议：`https://token-plan-cn.xiaomimimo.com/v1`
    * Anthropic 兼容协议：`https://token-plan-cn.xiaomimimo.com/anthropic`
  * API Key
    * 格式：`tp-xxxxx`

  
成功订阅后，前往 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 获取专属 Base URL 和 API Key  
  
## 使用 Qwen Code CLI

### 安装 Qwen Code CLI

**安装命令：**

  * macOS/Linux

    
    
    bash -c "$(curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.sh)" -s --source bailian
    

  * Windows

    
    
    curl -fsSL -o %TEMP%\install-qwen.bat https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.bat && %TEMP%\install-qwen.bat --source bailian
    

**验证安装（如有版本号输出，则表示安装成功）：**
    
    
    qwen --version
    

### 配置基本信息

**1.** **选择 API 密钥 -- > Custom API Key，进入自定义配置**

![图片](/static/NotfbGif3o8b8HxHltbcp3p7nQh.284b195f.png)

![图片](/static/UclYbu2WxoLZFyxnN13c4zC9n4c.0b2d08d8.png)

**2.** **编辑配置文件**

![图片](/static/DaLKb0tq4ouFwwxdHuIcO8OJnBg.f002218b.png)

更多详细配置信息可访问 [Qwen Code 配置官方文档](<https://qwenlm.github.io/qwen-code-docs/zh/users/configuration/model-providers/>)。

编辑或新建 `settings.json` 文件，具体路径如下：

  * macOS/Linux: `~/.qwen/settings.json`

  * Windows: `用户目录\.qwen\settings.json`

将以下内容完整复制到配置文件中（实际使用时按需更换配置信息）：

在配置基本信息时，需先检查是否存在 `MIMO_API_KEY` 的环境变量，如果存在，请先清除或者将值替换为对应使用方式获取的 API Key。
    
    
    {
      "env": {
        "MIMO_API_KEY": "MIMO_API_KEY"
      },
      "modelProviders": {
        "openai": [
          {
            "id": "mimo-v2.5-pro",
            "name": "mimo-v2.5-pro",
            "baseUrl": "BASE_URL",
            "envKey": "MIMO_API_KEY"
          }
        ]
      },
      "security": {
        "auth": {
          "selectedType": "openai"
        }
      },
      "model": {
        "name": "mimo-v2.5-pro"
      },
      "$version": 3
    }
    

### 使用 Qwen Code CLI

以上配置完成后，新建一个终端，执行以下命令启动 Qwen Code CLI。
    
    
    qwen
    

启动以后，即可在 Qwen Code CLI 使用 MiMo 模型。

![图片](/static/WnJWbJLHCok2gGxY0IpcGfROnfc.541c1904.png)

## 使用 Qwen Code IDE 插件

### 安装插件

在 VS Code 扩展市场搜索并安装 **Qwen Code Companion** 插件。

![图片](/static/P9KDbpXHiog7IRxu2zTc47HPnof.0385f4c9.png)

### 配置基本信息

可参考 Qwen Code CLI 中配置基本信息的步骤进行配置。

### 使用 Qwen Code 插件

点击右上角的 Qwen Code 图标打开对话框

![图片](/static/F0u8bEXY7ohrVLxUUSrcNksxnOe.331fac4e.png)

输入或点击 `/`，选择 `Switch model` 切换模型。

![图片](/static/HxxHbWwICoR5dLxGQaKc9N3knpc.53cc8ef6.png)

更新时间 2026 年 06 月 12 日

[Cherry Studio 配置](</docs/zh-CN/tokenplan/integration/cherrystudio>)[CodeBuddy 配置](</docs/zh-CN/tokenplan/integration/codebuddy>)