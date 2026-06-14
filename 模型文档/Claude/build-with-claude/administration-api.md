# Admin API

---

<Tip>
**Admin API 不适用于个人账户。** 如需与团队成员协作并添加成员，请在 **Console → Settings → Organization** 中设置您的组织。
</Tip>

[Admin API](/docs/zh-CN/api/admin) 允许您以编程方式管理组织的资源，包括组织成员、工作区和 API 密钥。这为管理任务提供了编程控制能力，否则这些任务需要在 [Claude Console](/) 中手动配置。

<Check>
  **Admin API 需要特殊访问权限**

  Admin API 接受两种凭据：通过 `x-api-key` 标头发送的 Admin API 密钥（以 `sk-ant-admin...` 开头），或通过 `authorization: Bearer` 标头发送的具有 `org:admin` 作用域的 OAuth 不记名令牌。只有具有 admin 角色的组织成员才能通过 Claude Console 配置 Admin API 密钥，并且只有具有 admin、owner 或 primary owner 角色的成员才能获取 `org:admin` 令牌。
</Check>

<Note>
**AWS 上的 Claude Platform：** Admin API 的大部分功能在 AWS 上的 Claude Platform 中不可用。工作区端点（在 `/v1/organizations/workspaces` 上的创建、获取、列出、更新和归档）可用。其他端点（包括组织成员、工作区成员、邀请、API 密钥、使用情况报告、成本报告和速率限制报告）不可用。详情请参阅 [AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws)。
</Note>

## 身份验证 \{#authentication}

使用任一凭据进行身份验证。以下示例以两种方式调用[组织信息端点](#accessing-organization-info)：

**OAuth 不记名令牌：**

```bash cURL nocheck
curl --fail-with-body -sS "https://api.anthropic.com/v1/organizations/me" \
  --header "anthropic-version: 2023-06-01" \
  --header "authorization: Bearer $ANTHROPIC_OAUTH_TOKEN"
```

`org:admin` 令牌授予对整个组织的访问权限，无论底层配置文件或联合规则绑定到哪个工作区。要获取该令牌，请参阅[使用 Admin API 管理 WIF](/docs/zh-CN/manage-claude/wif-admin-api#prerequisites) 中的先决条件。

**Admin API 密钥：**

```bash cURL nocheck
curl --fail-with-body -sS "https://api.anthropic.com/v1/organizations/me" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

## Admin API 的工作原理 \{#how-the-admin-api-works}

当您使用 Admin API 时：

1. 您使用[身份验证](#authentication)部分中的任一凭据发出请求
2. 该 API 允许您管理：
   - 组织成员及其角色
   - 组织成员邀请
   - 工作区及其成员
   - API 密钥
   - 服务账户、联合颁发者和联合规则（这些端点需要 `org:admin` OAuth 令牌；不接受 Admin API 密钥）

这适用于：
- 自动化用户入职/离职流程
- 以编程方式管理工作区访问权限
- 监控和管理 API 密钥使用情况

## 组织角色和权限 \{#organization-roles-and-permissions}

共有五种组织级别的角色。更多详情请参阅 [API Console 角色和权限](https://support.claude.com/en/articles/10186004-api-console-roles-and-permissions)一文。

| 角色 | 权限 |
|------|-------------|
| user | 可以使用 Workbench |
| claude_code_user | 可以使用 Workbench 和 [Claude Code](https://code.claude.com/docs/en/overview) |
| developer | 可以使用 Workbench 并管理 API 密钥 |
| billing | 可以使用 Workbench 并管理账单详情 |
| admin | 可以执行上述所有操作，并管理用户 |

组织 owner 和 primary owner 拥有所有 admin 权限，并且还可以管理 admin。本页面中所有对 admin 角色的引用同样适用于 owner 和 primary owner。

## 关键概念 \{#key-concepts}

### 组织成员 \{#organization-members}

您可以列出[组织成员](/docs/zh-CN/api/admin-api/users/get-user)、更新成员角色以及移除成员。

<CodeGroup>
```bash cURL
# 列出组织成员
curl "https://api.anthropic.com/v1/organizations/users?limit=10" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"

# 更新成员角色
curl "https://api.anthropic.com/v1/organizations/users/{user_id}" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY" \
  --data '{"role": "developer"}'

# 移除成员
curl --request DELETE "https://api.anthropic.com/v1/organizations/users/{user_id}" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

</CodeGroup>

### 组织邀请 \{#organization-invites}

您可以邀请用户加入组织并管理这些[邀请](/docs/zh-CN/api/admin-api/invites/get-invite)。

<CodeGroup>

```bash cURL
# 创建邀请
curl --request POST "https://api.anthropic.com/v1/organizations/invites" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY" \
  --data '{
    "email": "newuser@domain.com",
    "role": "developer"
  }'

# 列出邀请
curl "https://api.anthropic.com/v1/organizations/invites?limit=10" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"

# 删除邀请
curl --request DELETE "https://api.anthropic.com/v1/organizations/invites/{invite_id}" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

</CodeGroup>

### 工作区 \{#workspaces}

有关工作区的全面指南（包括 Console 和 API 示例），请参阅[工作区](/docs/zh-CN/manage-claude/workspaces)。

### 工作区成员 \{#workspace-members}

管理[用户对特定工作区的访问权限](/docs/zh-CN/api/admin-api/workspace_members/get-workspace-member)：

<CodeGroup>

```bash cURL
# 将成员添加到工作区
curl --request POST "https://api.anthropic.com/v1/organizations/workspaces/{workspace_id}/members" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY" \
  --data '{
    "user_id": "user_xxx",
    "workspace_role": "workspace_developer"
  }'

# 列出工作区成员
curl "https://api.anthropic.com/v1/organizations/workspaces/{workspace_id}/members?limit=10" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"

# 更新成员角色
curl --request POST "https://api.anthropic.com/v1/organizations/workspaces/{workspace_id}/members/{user_id}" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY" \
  --data '{
    "workspace_role": "workspace_admin"
  }'

# 从工作区移除成员
curl --request DELETE "https://api.anthropic.com/v1/organizations/workspaces/{workspace_id}/members/{user_id}" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

</CodeGroup>

### API 密钥 \{#api-keys}

监控和管理 [API 密钥](/docs/zh-CN/api/admin-api/apikeys/get-api-key)：

<CodeGroup>

```bash cURL
# 列出 API 密钥
curl "https://api.anthropic.com/v1/organizations/api_keys?limit=10&status=active&workspace_id=wrkspc_xxx" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"

# 更新 API 密钥
curl --request POST "https://api.anthropic.com/v1/organizations/api_keys/{api_key_id}" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY" \
  --data '{
    "status": "inactive",
    "name": "New Key Name"
  }'
```

</CodeGroup>

### 服务账户 \{#service-accounts}

创建和管理服务账户（`svac_...`），即 [Workload Identity Federation](/docs/zh-CN/manage-claude/workload-identity-federation)（工作负载身份联合）令牌所代表的非人类身份。服务账户、联合颁发者或联合规则端点不接受 Admin API 密钥；请使用 `org:admin` OAuth 令牌。请参阅[使用 Admin API 管理 WIF](/docs/zh-CN/manage-claude/wif-admin-api#service-accounts)。

### 联合颁发者 \{#federation-issuers}

注册 OIDC 身份提供商（`fdis_...`），其令牌可为您的组织声明工作负载身份。请参阅[使用 Admin API 管理 WIF](/docs/zh-CN/manage-claude/wif-admin-api#federation-issuers)。

### 联合规则 \{#federation-rules}

管理将颁发者令牌映射到服务账户和作用域的规则（`fdrl_...`）。请参阅[使用 Admin API 管理 WIF](/docs/zh-CN/manage-claude/wif-admin-api#federation-rules)。

## 访问组织信息 \{#accessing-organization-info}

使用 `/v1/organizations/me` 端点以编程方式获取有关您组织的信息。

例如：

```bash cURL
curl "https://api.anthropic.com/v1/organizations/me" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

```json
{
  "id": "12345678-1234-5678-1234-567812345678",
  "type": "organization",
  "name": "Organization Name"
}
```

此端点可用于以编程方式确定 Admin API 密钥所属的组织。

有关完整的参数详情和响应架构，请参阅[组织信息 API 参考](/docs/zh-CN/api/admin-api/organization/get-me)。

## 使用情况和成本报告 \{#usage-and-cost-reports}

使用[使用情况和成本 API](/docs/zh-CN/manage-claude/usage-cost-api) 跟踪您组织的使用情况和成本。

## Claude Code 分析 \{#claude-code-analytics}

使用 [Claude Code 分析 API](/docs/zh-CN/manage-claude/claude-code-analytics-api) 监控开发者生产力和 Claude Code 采用情况。

## 速率限制 \{#rate-limits}

使用[速率限制 API](/docs/zh-CN/manage-claude/rate-limits-api) 读取为您的组织及其工作区配置的速率限制。

## 合规 API \{#compliance-api}

使用[合规 API](/docs/zh-CN/manage-claude/compliance-api) 检索您组织的审计和活动数据。Admin API 密钥只能读取活动动态；如需完整访问权限，请参阅[获取合规 API 访问权限](/docs/zh-CN/manage-claude/compliance-api-access)。

## 最佳实践 \{#best-practices}

为了有效使用 Admin API：

- 为工作区和 API 密钥使用有意义的名称和描述
- 为失败的操作实施适当的错误处理
- 定期审核成员角色和权限
- 清理未使用的工作区和过期的邀请
- 监控 API 密钥使用情况并定期轮换密钥

## 常见问题 \{#faq}

<section title="使用 Admin API 需要什么权限？">

Admin API 接受 Admin API 密钥（以 `sk-ant-admin` 开头）或具有 `org:admin` 作用域的 OAuth 不记名令牌。只有具有 admin 角色的组织成员才能配置 Admin API 密钥，并且只有具有 admin、owner 或 primary owner 角色的成员才能获取 `org:admin` 令牌。请参阅[身份验证](#authentication)。

</section>

<section title="我可以通过 Admin API 创建新的 API 密钥吗？">

不可以，出于安全原因，新的 API 密钥只能通过 Claude Console 创建。Admin API 只能管理现有的 API 密钥。

</section>

<section title="移除用户时 API 密钥会怎样？">

API 密钥会保持其当前状态，因为它们的作用域是组织，而不是单个用户。

</section>

<section title="可以通过 API 移除组织管理员吗？">

不可以，出于安全原因，具有 admin 角色的组织成员无法通过 API 移除。

</section>

<section title="组织邀请的有效期是多久？">

组织邀请在 21 天后过期。目前无法修改此过期期限。

</section>

有关工作区的具体问题，请参阅[工作区常见问题](/docs/zh-CN/manage-claude/workspaces#faq)。