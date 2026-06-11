# Lyra 视觉浏览器操作模式 — 实现方案

## Context(为什么做)

Lyra 现有的浏览器自动化是**结构化语义优先**(DOM + 无障碍树)的方案,这条路径已经很强;但**视觉操作能力几乎为零** —— 当前只有一个在 DOM 被 block 时生成的 40×40 "视觉兜底元素"(`createVisualFallbackElement`),且被当成高风险特殊处理。对于 canvas/WebGL、地图、自定义渲染控件、被 block 的跨域 frame 这类 DOM 拿不到的场景,Lyra 基本无能为力。

目标:从 0 到 1 做一套**强大的纯视觉操作模式**,快准狠,对标参考项目 Magnitude(`参考/browser-agent`,vision-first,WebVoyager 94%)和 Devin。具体要求(用户明确):

1. **纯视觉工具** + **真实设备像素坐标**(不要 Magnitude 那种虚拟标准屏)。
2. **模式选择"两者都要"**:(a) 新增显式视觉工具让 **agent 自主选** DOM 还是视觉;(b) 系统也能**自动混合/自动降级**(按 DOM 覆盖率自动决定)。
3. **保留现有风险门控**,接入现有权限审批流程(全自动模式会自动批)。
4. **模型不支持视觉输入时自动回退到 DOM 模式,绝不报错中断**。
5. **★ 鲁棒处理面板布局变化导致的尺寸/画面变化** —— 用户开关 AI 面板、终端面板、拖拽调整面板尺寸、窗口在不同 DPR 屏间移动时,内嵌浏览器视图会被 resize,截图坐标系随之失效。这是纯视觉方案的命门,必须做对(详见第 2、5 节)。

> **范围边界**:本方案只做"视觉操作能力"本身(截图→模型给坐标→点击)。

---

## 现状结论(已查清,直接复用)

**模型视觉能力检测 — 已存在**
- 权威字段 `ModelCapabilityProfile.supports_image_input`(`crates/lyra-agent-runtime/src/native_backend/provider.rs:149`),由 provider 配置 `supportsImageInput` 解析(`provider_config.rs:84-86`)。
- 图片→消息已据此降级:`context_builder.rs:192-225`(不支持则替换为 `[Image omitted: model_does_not_support_image_input]`);`provider.rs:642-648` 工具产图在 `!supports_image_input` 时直接不进消息。
- 暴露给 TS:`native_backend/context.rs:250` 输出 `supportsImageInput`;`apps/desktop/src/shared/agent.ts:1026`。

**截图进上下文管道 — 已存在**
- `lyra_lumen_see` handler:`apps/desktop/src/main/agent/service.ts:2617-2674`,`captureAgentPage()` → `materializeLumenCapture()` 落 artifact → `raw.providerImage`(被 `provider.rs:649` 读取)。背景标签页 `background_visual_capture_unsupported` 已自动降级文本(`service.ts:2625-2653`)。

**坐标与截图 — 存在 DPR 错配(核心要解决)**
- `capturePage()`(`view-manager.ts:3474-3489`)用 `webContents.capturePage()`,返回 `width/height` 是**物理像素**(CSS×DPR)。
- `actOnAgentPoint()`(`view-manager.ts:6332-6410`)→ `performAgentPointerInteraction`(1603-1680)→ `sendAgentInputEvent`(1503-1512)→ `webContents.sendInputEvent({x,y})`,坐标是 **CSS/DIP 像素**。
- viewport 原语:`readBrowserAgentViewportState`(`view-manager.ts:5085-5139`)返回 CSS 像素的 width/height/scrollX/scrollY/maxScroll;`window.devicePixelRatio` 已在 `view-manager.ts:487`/`3179`/`5087` 被读。
- `actOnAgentPoint` 已内置 `autoScrollPointIntoViewport`(6351),点在 viewport 外会自动滚进来 —— 对视觉模式是有用的安全网。

**风险门控 / 全自动 — 已存在**
- 风险分级 `permission_risk()`(`native_backend/permissions.rs:72`),`lyra_lumen.act` 已判 `"dangerous"`(156-170)。
- 策略 `evaluate_permission_policy()`(`permission_policy.rs:237-264`):`full_auto` 无匹配规则一律 `Allow`,否则 `Ask`。
- 全自动旁路:`permissions.rs:11-21`,输入带 `permissionMode=="full_access"` 或 `permissionGranted==true` 直接跳过。
- UI 权限模式选择器:Composer `permissionModeControls`(`Composer.tsx:379-400`)。

**★ 布局/尺寸变化链路 — 已查清,且当前无坐标失效保护**
- 浏览器视图 bounds 设置:`view-manager.ts` 的 `applyLayout()`(851-971),对每个可见 tab `entry.view.setBounds(nextBounds)`(956)。
- 触发源:`syncLayout(snapshot)`(2512-2515)由 IPC `workbenchBrowserSyncLayout`(`service.ts:306-307`)驱动。
- 渲染侧:`shell/browser-layout-sync.ts` —— `window.resize` 监听(193-201)+ 每个 tab 容器 `ResizeObserver`(247-250)→ `scheduleSync()` → rAF → `toSnapshot()` → IPC。
- 面板开关/拖拽:`shell/use-panel-layout.ts` —— `toggleLeftPanel`(215)/`toggleBottomPanel`(219)/拖拽 `onLeftResizeMouseDown`(128)/`onBottomResizeMouseDown`(149),改 CSS 变量 `--left-width`/`--bottom-height`(203-213)→ DOM 重排 → ResizeObserver。
- `readBrowserAgentViewportState` 是**实时**读取(每次执行 JS),但**没有任何机制在 resize 后让"已截图的坐标系"失效**。已有 `WorkbenchLumenStaleTarget`(5046)只针对 DOM 元素失效,不覆盖视觉截图。
- DPR 变化(跨屏移动/页面 zoom)**当前无监听**。

---

## 1. 整体架构

视觉模式作为与 DOM 路径**并存的第二条 observe/act 通道**,不替换 DOM。三种工作方式并存:
- **(A) Agent 自主选**:新增显式视觉工具,工具描述引导模型在 DOM 失败/被 block/canvas 类页面时选视觉。
- **(B) 系统自动混合/降级**:observe 层按 DOM 覆盖率自动附图并推荐视觉工具。
- **(C) 无视觉兜底**:`supports_image_input==false` 时视觉路径自动回退 DOM observe。

命名(沿用 `lyra_lumen`):
- 新增视觉 act 工具:**`lyra_lumen_vact`**(visual act),与现有 `lyra_lumen_act` 并列。
- 视觉 observe 复用 **`lyra_lumen_see`**,扩展返回 `VisualFrame` 元数据(坐标系自描述)。
- 内部 host 方法建议直接复用 `actOnAgentPoint`,坐标归一化在上层做,避免重复造轮子。

视觉 act 一轮数据流:
```
模型 → lyra_lumen_vact(x_phys,y_phys,interaction,reason,captureId)
  → browser_adapter(Rust) → host → service.ts vact handler
      → 校验 captureId 未失效(见第2节)
      → 坐标归一化 x_css = x_phys / dpr
      → 复用 actOnAgentPoint(tabId,{point:{x_css,y_css},interaction})
          → autoScrollPointIntoViewport → performAgentPointerInteraction → sendInputEvent
  → 返回 actionResult + 新 VisualFrame/captureId
```

---

## 2. ★ 坐标系方案(真实设备像素 + 抗布局变化)

**核心约定**:模型看到的图 = `capturePage()` 输出(物理像素,viewport 可见区,原点 viewport 左上)。模型回的坐标 = 该图上的物理像素。

引入 `VisualFrame` 元数据,**与截图一起返回,act 时回传校验**:
```
VisualFrame = {
  captureId,            // 单调递增 id,绑定截图与坐标系(关键失效凭据)
  dpr,                  // window.devicePixelRatio
  cssViewportWidth,     // window.innerWidth
  cssViewportHeight,    // window.innerHeight
  imageWidth,           // capturePage size.width (= cssW * dpr * imageScale)
  imageHeight,
  imageScale,           // 默认 1;仅超模型图片上限时等比缩小
  scrollX, scrollY,     // CSS px
  viewBoundsHash        // 当前 WebContentsView bounds + dpr 的指纹(抗布局变化, 见下)
}
```

**坐标换算(vact handler 内)**:
```
x_css = x_phys / dpr / imageScale
y_css = y_phys / dpr / imageScale
→ actOnAgentPoint({point:{x:x_css, y:y_css}})  // 内部已 round + max(0,..)
```
- **不引入虚拟标准屏**:截图发模型时默认不缩放(`imageScale=1`);仅当超过模型图片尺寸上限时等比缩小并记 `imageScale`。

**★ 抗布局变化(本次新增需求的核心)**:
- **失效凭据 `captureId` + `viewBoundsHash`**:每次 `captureVisualFrame` 生成新 `captureId`,并记录当时的 `viewBoundsHash`(= 该 tab 的 `entry.view.getBounds()` 物理尺寸 + dpr 的哈希)。
- **vact 执行前强制校验**:handler 在点击前**实时重读**当前 tab 的 bounds+dpr 计算 `viewBoundsHash`,与传入 `captureId` 绑定的 hash 比对:
  - **一致** → 坐标系有效,正常换算并点击。
  - **不一致**(用户在截图后开关/拖了面板、跨屏移动改了 dpr)→ **拒绝点击**,返回 `kind:"lyraLumenVactStale"`,`reason:"viewport_resized"`,`recommendedAction:"lyra_lumen.see"`,提示模型重新截图再给坐标。**绝不按旧坐标点歪。**
- **resize 主动事件(让失效即时可感知)**:在 `applyLayout()`(`view-manager.ts:851-971`)对某 tab `setBounds` 且 bounds 实际变化时,bump 该 tab 的 `viewBoundsEpoch`(view-manager 内存计数器)。`captureVisualFrame` 把 epoch 编进 `captureId`;vact 校验时 epoch 不符即判失效。这比每次重算 hash 更轻量,二者可二选一或并用(推荐 epoch 为主、hash 为兜底)。
- **DPR 变化**:`viewBoundsHash`/epoch 已包含 dpr,跨屏移动或页面 zoom 改变 dpr → hash 变 → 旧 captureId 失效 → 模型重截图。无需单独监听 DPR。

**滚动 / 全页**:
- vact 默认针对当前 viewport 截图。需要看下方时模型用 `interaction:"scroll"`(scrollDy 以 CSS px),滚动后**重新截图 + 新 captureId**(滚动也会让 `scrollY` 变,旧 captureId 失效)。
- 不用 CDP 全页图做 act(全页图坐标无法直接映射 viewport sendInputEvent);全页图仅供"看大局"。

**新增/修改函数**:
- 新增 `captureVisualFrame(tabId)`(view-manager.ts):= `capturePage()`(3474)+ `readBrowserAgentViewportState()`(5085)+ dpr + 当前 `viewBoundsEpoch`,返回 `{imageBase64, VisualFrame}`。视觉 observe/act 统一入口。
- 新增 `currentViewBoundsHash(tabId)` / `viewBoundsEpoch` 计数器(view-manager.ts),在 `applyLayout` 的 setBounds 变化处 bump。
- 复用 `actOnAgentPoint`(不改签名),换算+校验在 service.ts handler。

---

## 3. 新增/修改工具(Rust `tool_activity_service.rs`)

**新增 `lyra_lumen_vact`**(在 `tool_activity_service.rs:599` 现 `lyra_lumen_act` 旁注册):
- 描述(引导选择):
  > "Visually click/drag/scroll using REAL device-pixel coordinates read directly off the latest lyra_lumen_see screenshot. Use ONLY when DOM mapping is unavailable or unreliable: canvas/WebGL apps, custom-rendered widgets, blocked frames, or when lyra_lumen_map/act returned no usable targetRef. Always call lyra_lumen_see first and read coordinates from that exact image; pass its captureId. Prefer lyra_lumen_act with a targetRef whenever a DOM target exists — it is more reliable. If the page layout changed since the screenshot, this tool will reject the coordinates and ask you to re-capture."
- schema(复用 `lumen_target_schema()` `:1781` 拿 tabId/targetMode/authState),新增:
  - `point:{x,y,reason}`(device px,x/y required)
  - `captureId`(string,required,失效则拒)
  - `interaction`(enum: click/doubleClick/rightClick/hover/drag/scroll,default click)
  - `to:{x,y}`(drag 目标 device px)、`scrollDy`(scroll 的 CSS px delta)、`timeoutMs`

**修改 `lyra_lumen_see`**(`:588`):描述补充"返回 imageWidth/imageHeight(device px)、dpr、captureId、scrollX/Y;坐标用于 lyra_lumen_vact"。返回体加 `VisualFrame`(在 service.ts handler 实现)。

**`prompt_policy.rs`**(浏览器策略段)加总则:"Default to DOM tools (map/act with targetRef). Switch to vision (see + vact) when DOM coverage is low, frames are blocked, or the page is canvas/WebGL. If the active model has no image input, vision tools transparently fall back to DOM extraction. Always re-capture (see) after scrolling or any panel/window resize before using vact coordinates."

---

## 4. 自动混合 / 降级(系统自动决定走视觉)

放在 **view-manager 的 observe 聚合层**(`observeAgentPage`/`lyra_lumen_map` 产出处),Rust 拿不到 DOM 覆盖率原始数据。
- 信号:`elements.length` 过少 / blocked frame 占比高(现有 `createVisualFallbackElement` `:4215` 的触发条件)。
- 行为:DOM 覆盖率低于阈值且 `supports_image_input==true` 且视觉模式未被关 → observe 结果自动附一张 viewport 截图 + `VisualFrame`,`nextRecommendedAction` 设 `lyra_lumen_vact`,`recommendedTool`(已有字段 `service.ts:560`)指向视觉。
- 统一旧兜底:`createVisualFallbackElement` 的 `actionHint:"visual_click_requires_risk_review"`(`:4258`)改为 `"use_visual_act"`,不再当特殊高风险元素,走标准 vact 门控(第 6 节)。
- gate:阈值受 capability + 视觉自动混合开关共同控制;不支持图片则永不附图。

---

## 5. Capability detection + 自动回退 DOM

检测点(已存在):`supports_image_input`(`provider.rs:149`)。

回退三处协同:
1. **工具执行层(主防线,service.ts)**:仿 `lyra_lumen_see` 已有的 `background_visual_capture_unsupported` 降级(`service.ts:2625-2653`)。`lyra_lumen_vact`/`see` handler 收到 `modelSupportsImageInput==false` 时,执行一次 DOM observe(`observeAgentPage`/`readAgentPage`),返回 `kind:"lyraLumenVactFallback"` + `message:"Active model has no image input; fell back to DOM extraction. Use lyra_lumen_map + lyra_lumen_act."` + `nextRecommendedAction:"lyra_lumen.map"`。**不抛错。**
2. **上下文层(已自动)**:即使截了图,`provider.rs:646` 会拦掉不支持模型的图片消息,`context_builder.rs:215` 给文本说明。"图发不出去"这层已安全。
3. **能力传递接线**:在 `native_backend/tools/mod.rs:862` 工具派发处(`execute_host_tool_adapter` 附近),把当前 turn 的 `capabilities.supports_image_input`(`turns.rs:375` 已有)注入视觉工具 input(如 `input["modelSupportsImageInput"]=false`),供 service.ts handler 走回退分支。

---

## 6. 风险门控接入(复用,无新机制)

- `permissions.rs:159` 的 `permission_risk` match 加 `("lyra_lumen","vact") => "dangerous"`(与 act/type/press/submit 同级);drag/scroll 同判 dangerous。
- 自动效果:approval 模式 → `Ask` → 现有审批弹窗(`permissionRequested` 事件);full_auto → `Allow` 自动批;full_access 旁路(`permissions.rs:11-21`)自动继承。
- `permission_summary`(`permissions.rs:175-207`)key 列表加 `"reason"`,把 vact 的 point.reason 带进审批摘要。
- **废弃旧的 "visual_click_requires_risk_review" 特殊路径**(`view-manager.ts:6093` 附近 + actionHint):视觉点击统一为 vact → dangerous,门控一致。

---

## 7. UI / 面板变化处理

> 用户澄清:此处重点**不是**给视觉模式加开关,而是**处理好用户开关 AI/终端面板、调整尺寸导致的画面/坐标变化**。该鲁棒性核心已在第 2、5 节(captureId + viewBoundsEpoch/Hash 失效)解决。本节补充 UI 侧最小接线。

- **核心保证**(已在第 2 节):任何面板开关/拖拽/跨屏移动导致浏览器视图 bounds 或 dpr 变化 → `applyLayout` bump `viewBoundsEpoch` → 旧 `captureId` 在 vact 校验时即失效 → 模型被要求重新 `lyra_lumen_see`。**用户怎么折腾布局都不会点歪。**
- **(可选)视觉自动混合开关**:若希望用户能开关"系统自动附图"行为,照抄 follow-toggle 全链路:`use-lyra-agent-data-provider.ts` 加 state + snapshot(仿 follow `:360/:518/:688/:1356`)、`Composer.tsx` 加 toggle 按钮(仿 follow `:423-439`)、preload/bridge/main IPC(仿 `service.ts:3696` follow handler)。模型不支持图片时按钮置灰 + tooltip。此项非必须,默认可"系统自动 + agent 自主"无需用户开关。
- **resize 期间不截图**:`use-browser-layout-animation-sync.ts`(动画期间高频同步)期间 bounds 在变,若 vact/see 恰在此时发生,epoch 会频繁 bump 自然导致失效重试;无需额外处理,但可在 handler 对"连续失效"返回更明确提示。

---

## 8. 关键文件清单与改动(按层分组)

**Rust(`crates/lyra-agent-runtime/src/`)**
- `tool_activity_service.rs:599`(新增 `lyra_lumen_vact` capability,schema 复用 `lumen_target_schema` `:1781`);`:588` 改 `lyra_lumen_see` 描述。
- `native_backend/permissions.rs:159`(`permission_risk` 加 vact=dangerous);`:183` summary 加 `reason`。
- `native_backend/tools/mod.rs:862`(派发视觉工具前注入 `modelSupportsImageInput`,取自 `turns.rs:375`)。
- `prompt_policy.rs`(浏览器策略段加视觉 vs DOM 选择 + 回退 + resize 后重截图总则)。
- (复用不改)`context_builder.rs:192`、`provider.rs:642`、`permission_policy.rs:237`。

**TS main(`apps/desktop/src/main/`)**
- `workbench-browser/view-manager.ts`:新增 `captureVisualFrame(tabId)`(组合 `capturePage:3474` + `readBrowserAgentViewportState:5085` + dpr + epoch);新增 `viewBoundsEpoch` 计数器 + 在 `applyLayout:851-971` setBounds 变化处 bump + `currentViewBoundsHash`;`createVisualFallbackElement:4215` 的 actionHint 改引导 vact;observe 聚合层加 DOM 覆盖率→自动附图。复用 `actOnAgentPoint:6332`(不改签名)。
- `agent/service.ts`:新增 `lyraLumen.vact` handler(仿 `lyraLumen.act:2131`):校验 captureId/epoch → `x_css=x/dpr/imageScale` → `actOnAgentPoint`;capability 回退分支(仿 background 降级 `:2625`)。改 `lyraLumen.see` handler(`:2617`)返回加 `VisualFrame`。
- `native_backend/tools/browser_adapter.rs`:转发 `lyra_lumen.vact` 到 host(仿现有 act 转发)。

**TS renderer / 共享(可选 UI 项)**
- `modules/workbench/ai-panel/use-lyra-agent-data-provider.ts`、`.../agent-chat-demo/features/chat/Composer.tsx`、`ChatView.tsx`、`core/i18n.ts`、`preload/index.ts:1551`、`shared/desktop-bridge.ts`、`shared/agent.ts`:仅当决定加"自动混合开关"时按 follow-toggle 全链路接线。

---

## 9. 验证方式

**Rust 单测(`native_backend/tests/`)**
- 仿 `provider_loop.rs`(已有 `supports_image_input` 用例 `:1153/:371`):`lyra_lumen_vact` 在 `modelSupportsImageInput=false` 时走 DOM 回退而非报错。
- 权限测试:`permission_risk("lyra_lumen","vact")=="dangerous"`;approval 生成 request、full_auto `Allow`、full_access 旁路跳过。
- `context_builder` 补:vact 截图在不支持模型下降级为文本。

**TS 单测(`workbench-browser/tests/` + `agent/tests/service.test.ts`)**
- 坐标换算:dpr=2、imageWidth=2560、cssViewport=1280,模型坐标 (1000,500) → 断言传给 `actOnAgentPoint` 的 point ≈ (500,250)(mock `actOnAgentPoint` 验入参)。
- **★ 布局失效**:截图得 captureId(epoch=N)→ 模拟 `applyLayout` bump epoch=N+1 → vact 用旧 captureId → 断言返回 `lyraLumenVactStale`/`reason:"viewport_resized"`,**不调用** `actOnAgentPoint`。
- captureId 过期(滚动后)同样被拒并提示重截图;`modelSupportsImageInput=false` 返回 `lyraLumenVactFallback`。

**端到端手动**
1. 视觉点击精度:打开 canvas/地图页 → 任务"点某按钮" → agent see→vact,光标落点正确。**在 Retina(dpr=2)外接屏与内置屏分别测**,验证 DPR 换算。
2. **★ 面板变化**:截图后,开/关 AI 面板、开/关终端、拖拽分割线、把窗口拖到不同 DPR 屏 → 再让 agent vact → 应被拒并自动重新 `lyra_lumen_see` 后正确点击(不点歪)。
3. 权限:approval 模式 vact 弹审批;full_auto 自动执行。
4. 不支持图片模型(provider `supportsImageInput:false`)→ 视觉路径自动回退 DOM,任务不中断。
5. 滚动:vact `interaction:"scroll"` 后 captureId 更新,旧坐标被拒。

---

## 复用 vs 新增小结
- **复用**:`capturePage`、`actOnAgentPoint`(含 autoScroll/sendInputEvent)、`readBrowserAgentViewportState`、`applyLayout` 的 setBounds 链、`lumen_target_schema`、`permission_risk`/`evaluate_permission_policy`/审批全套、`supports_image_input` + `context_builder` 图片降级、`materializeLumenCapture`/providerImage artifact、(可选)follow-toggle UI/IPC 全链路。
- **新增**:`lyra_lumen_vact` 工具+schema、`captureVisualFrame`+`VisualFrame`、`viewBoundsEpoch`/`viewBoundsHash` 失效机制(★抗布局变化)、service.ts vact handler(DPR 换算 + 失效校验 + 回退)、DOM 覆盖率自动附图、`permission_risk` 一行映射、prompt 选择策略。
