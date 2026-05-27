# Lyra Docs (Standalone Fumadocs Project)

`web/docs` 是独立于桌面端的官方文档站项目，可单独部署，也可在 Lyra 内以标签页打开。

## 开发命令
1. `npm install`
2. `npm run dev`
3. 打开 `http://localhost:5174/docs`
4. 质量检查：`npm run types:check && npm run build`

根目录 `npm run dev:desktop` 会随桌面开发环境一起启动文档站；只启动桌面端可用 `npm run dev:desktop:app`。

## 目录规范
1. 文档内容：`content/docs`
2. 多语言文件命名：`<slug>.<locale>.mdx`
3. 多语言导航：`meta.<locale>.json`
4. 运行模式桥接：`components/runtime-mode.tsx`
5. i18n 与语言解析：`lib/i18n.ts`、`lib/runtime-context.ts`、`middleware.ts`

## 运行模式
1. `host=lyra`：文档跟随 Lyra 传入的 `theme/locale`，并隐藏站内语言/主题开关。
2. standalone：文档使用站内语言/主题切换，语言通过 URL + cookie 持久化。

## 写作准则（少即是多）
1. 先讲边界，再讲能力，再给操作路径。
2. 用列表和短段落，避免冗长叙事。
3. 文档内容必须与仓库当前实现一致，避免“计划文档”冒充“现状文档”。
4. 新增页面时，中英页面需同名双语同步提交。
