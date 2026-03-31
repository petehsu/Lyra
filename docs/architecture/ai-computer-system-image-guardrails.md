# AI 电脑系统镜像化 Guardrails

## 目标
这份约束用于保证 Lyra AI 电脑后续可以安全演进到：
- 官方系统可卸载
- 第三方系统可安装
- 多系统并存与会话级切换
- 真正重装/真切换（旧系统运行态与核心状态不残留）

本文件关注“可打包、可替换、可演进”的架构地基，不讨论商店、签名体系、分发策略细节。

## 最高原则
1. **宿主与系统镜像解耦**
- Lyra desktop 是宿主，不是单一硬编码系统。
- AI 电脑系统是“可安装镜像”，不是写死在 renderer/main 的业务逻辑。

2. **系统真相必须 native-owned**
- 镜像注册表、安装/卸载、会话绑定、运行模式、兼容性门禁必须由 Rust 模块负责。
- TypeScript 只做桥接、事件转发、UI 投影。

3. **renderer 不持有系统真相**
- renderer 可持有瞬时 UI 状态（输入草稿、拖拽中 frame），不能持有系统注册表/安装状态真相。

## 职责边界
### Rust（必须拥有）
- `crates/lyra-system-image-napi`
  - 镜像 manifest 校验
  - API 版本门禁
  - 平台产物匹配
  - registry/data/install-path 变更
  - 卸载与可选数据清理
- `crates/lyra-computer-napi`
  - 会话级电脑状态机
  - 应用/窗口调度与持久化

### Electron Main（只能薄桥）
- `apps/desktop/src/main/system-image/service.ts`
  - IPC 绑定
  - request 归一化
  - window 事件分发
  - 官方 seed 安装入口
- 禁止在 main service 中重写镜像核心逻辑（安装、持久化、兼容性判定）

### Renderer（只投影）
- `apps/desktop/src/modules/workbench/ai-panel/computer/*`
  - 渲染系统状态与回调
  - 通过 model/service 调用 bridge
- 禁止绕过 model 直接访问 `window.lyraDesktop` 或在 view 内直接写系统域逻辑

## 禁止项（红线）
1. 在 `main/system-image/service.ts` 中新增 `fs` 持久化 fallback。
2. 在 `main/system-image/service.ts` 中新增 child_process 作为镜像安装/运行核心路径。
3. 在 renderer 的 AI 电脑模块使用 `localStorage/sessionStorage` 保存系统真相。
4. 在 AI 电脑视图层直接调用 `desktopApi.systemImages.*`，绕过 model/service。
5. 在 native-owned 域保留 “Fall through to TypeScript implementation” 兼容分支。

## 打包就绪检查清单
每次改动 AI 电脑或系统镜像域时至少通过：
1. `npm run lint:structure`
2. `npm run lint:rust-first`
3. `npm run lint:ui-style`
4. `npm --prefix apps/desktop run typecheck`
5. `npm --prefix apps/desktop run native:build`

并且满足：
- `Cargo.toml` workspace 包含 `lyra-system-image-napi` 与 `lyra-computer-napi`
- `apps/desktop/package.json` 的 `native:build` 包含对应 `-p` 参数
- `apps/desktop/src/main/index.ts` 已接线对应 bridge factory

## 守卫脚本映射
- `tools/verify-rust-first.ts`
  - 校验 native-owned 模块完整形态（service/loader/types/index/crate）
  - 校验 workspace crate 注册
  - 校验 desktop `native:build` 覆盖所有 native-owned crate
  - 校验 `main/index.ts` bridge factory 接线
  - 校验 native-owned service 不出现 forbidden fallback 模式
- `tools/verify-boundaries.ts`
  - 校验 renderer/main 边界导入
  - 校验 AI 电脑模块不绕过 model 直接访问系统桥接或浏览器存储

## 变更流程建议
1. 先改 Rust 能力与 shared contract。
2. 再改 main bridge（薄层）。
3. 最后改 renderer 投影与 UI。
4. 每步都跑守卫，避免后期集中返工。

## 演进预留
本约束与后续能力兼容：
- 社区系统镜像市场
- 签名与信任链
- 镜像沙箱策略升级
- 会话级/项目级系统策略
