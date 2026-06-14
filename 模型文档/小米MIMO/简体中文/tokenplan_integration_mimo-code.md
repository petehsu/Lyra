# MiMo Code 配置

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

# MiMo Code 配置

[**MiMo Code**](<https://mimo.xiaomi.com/zh/mimocode>) 是小米推出的终端 AI 编程助手，可通过 CLI 方式在终端中使用。**按量付费的 MiMo API** 和 **Token Plan** 均支持 MiMo Code，可参考本文进行配置与使用。

**限时福利**

  * 成功登录授权 MiMo Code，每位用户每日可免费使用联网搜索功能 **1000 次** 。使用次数超限后，请前往开放平台手动开通对应服务，并确保账户余额充足。

## 前置工作

MiMo Code 可直接跳转至[Xiaomi MiMo API 开放平台](<https://mimo.mi.com/docs/zh-CN/welcome>)完成授权登录，也可使用平台返回的授权码登录，全程无需手动配置 API Key。系统提供两种密钥类型，你可结合实际使用场景按需选择。

> 注意：授权登录 MiMo Code 前，请确保开放平台账户存有可用余额或有效 Token Plan，否则将导致授权失败。

使用方式 | 说明 | 获取与管理方式  
---|---|---  
按量付费 API 调用 | 按实际使用量计费，适合轻度使用 | 授权成功后，平台会自动创建一个以 `mimo-code-cli-key` 为前缀的新 API Key，可前往 [API Keys](<https://platform.xiaomimimo.com/#/console/api-keys>) 页面查看和管理  
Token Plan | 固定订阅费，按套餐限量调用 | 可前往 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 页面查看当前 Token Plan 的额度、使用情况与有效期  
  
## 安装 MiMo Code

MiMo Code 支持两种安装方式。

**方式一：官方脚本安装（适用于 macOS/Linux）**

> 为了更佳的用户体验，强烈推荐 Mac 用户使用 iTerm 或 VSCode Terminal。
    
    
    curl -fsSL https://mimo.xiaomi.com/install | bash
    

**方式二：npm 安装（适用于 Windows）**

需先安装 Node.js 18 或更新版本。
    
    
    npm install -g @mimo-ai/cli
    

**验证安装（如有版本号输出，则表示安装成功）：**
    
    
    mimo --version
    

## 连接供应商

你可以通过以下两种方式连接 Xiaomi MiMo 供应商：

**1.** **已启动 MiMo Code**

在交互界面运行 `/connect` 或者 `/login` 命令，选择 `Xiaomi` 作为供应商。

**2.** **未启动 MiMo Code**

直接在终端执行以下命令，选择 `MiMo` 完成授权。
    
    
    mimo auth login
    

确认操作后，将自动唤起 MiMo 授权登录弹窗。按提示完成登录跳转后，可根据您的实际使用场景，选择授权密钥类型：

![图片](/static/BfcFbTBvGo3c1jxu0z8c8eWFnQd.8f9629b2.png)

## 使用 MiMo Code

### 快速上手

按以下步骤在项目中使用 MiMo Code：
    
    
    # 1. 切换到你的项目目录
    cd /path/to/your/project
    
    # 2. 启动 MiMo Code
    mimo
    
    # 3. （推荐）初次使用时，初始化项目配置
    /init
    

初次使用时，强烈建议运行 `/init` 命令：

  * 该命令会自动分析你的项目结构与编码规范
  * 在项目根目录生成 `AGENTS.md` 文件
  * 后续 MiMo Code 会基于此文件更好地理解你的项目上下文，提升交互质量

更多命令与详细使用方式，请参考 [MiMo Code 官方文档](<https://mimo.xiaomi.com/zh/mimocode/interaction>)。

![图片](/static/Tx3ubbfd0oV5OyxZPmhcU4EKnhf.3867588b.png)

### 模型选择

运行 `/models` 命令，可查看并选择当前可使用的模型。

## 常见问题

### 在 Windows 系统验证安装时，遇到如下报错，如何解决？

> It seems that your package manager failed to install the right version of the mimocode CLI for your platform. You can try manually installing "@mimo-ai/mimocode-windows-x64" or "@mimo-ai/mimocode-windows-x64-baseline" package

回答： 按照提示执行命令 `npm install -g @mimo-ai/mimocode-windows-x64` 即可解决。

### 为什么看不到模型思考内容？

回答：MiMo Code 默认不展示模型返回的思考内容，可通过 `/thinking` 命令切换对话中推理块的可见性。启用后，即可查看支持扩展思考模型的完整推理过程。

> 注意：该命令并非模型思考功能的开关，无法开启或关闭模型的思考过程。

### 为什么授权登录不成功？

回答：请查看你的开放平台账户是否有足够余额，或是是否持有可用的 Token Plan。

更新时间 2026 年 06 月 12 日

[AI 工具总览](</docs/zh-CN/tokenplan/integration/tools-overview>)[OpenCode 配置](</docs/zh-CN/tokenplan/integration/opencode>)