# Web Workspace

`web/` 是 Lyra 所有网页端资产的唯一入口，用于避免网页代码散落到桌面端目录。

## 目录职责
1. `web/docs`：官方文档站（优先建设）。
2. `web/shared`：跨网页资产复用的品牌与内容组件资源。
3. `web/site`：Lyra 官网落地页（静态 `index.html` + 图片素材）。

## 边界规则
1. 网页代码不要放到 `apps/desktop`。
2. `web/*` 与 Electron Renderer 逻辑解耦，只共享静态设计语言资产（token、图标、MDX 组件）。
3. 文档与官网的框架实现后续只在 `web/` 内演进。

## 下一步
1. `web/docs` 已接入 Fumadocs，后续迭代内容与交互演示组件。
2. 在 `web/shared` 建立统一 token 与组件发布策略。
