# Lyra Docs

`web/docs` 是 Lyra 的公开文档站，可独立运行，也可在 Lyra 内以标签页打开。它只包含用户文档和承诺公开的外部接口；内部架构、IPC、存储格式和实现 ABI 属于仓库根目录 `docs/`。

## 开发命令

1. `pnpm install`
2. `pnpm --filter @lyra/docs-web dev`
3. 打开 `http://localhost:5174/docs`
4. 内容与契约检查：`pnpm --filter @lyra/docs-web check`
5. 构建：`pnpm --filter @lyra/docs-web build`

根目录 `pnpm dev:desktop` 会随桌面开发环境一起启动文档站。

## 目录规范

- 文档内容：`content/docs`
- 多语言文件：`<slug>.<locale>.mdx`
- 多语言导航：`meta.<locale>.json`
- 公开 Schema：`public/contracts/v1`
- 可运行示例：`public/examples/v1`
- 文档与契约校验：`scripts`

## 运行模式

- `host=lyra`：文档跟随 Lyra 传入的 `theme/locale`，并隐藏站内语言/主题开关。
- standalone：语言通过 URL、请求头与 cookie 解析。

## 发布准则

- 只描述仓库当前实现；未来计划必须明确标注。
- 每页必须包含状态、适用应用版本和核验日期。
- `supported` 接口遵守公开兼容策略；`preview` 接口只通过 Changelog 提前告知变化。
- 中英文页面必须同 slug、同导航、同章节 ID。
- 不公开 Tool-FS、Electron IPC/preload、runtime socket、SQLite schema、内部 package/crate 或 Agent ABI。
- 不把声明性的权限字段描述为强制隔离，也不把受信任 UIUX 代码描述为沙箱。
