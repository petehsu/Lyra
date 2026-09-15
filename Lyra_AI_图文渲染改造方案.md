# Lyra AI 图文渲染改造方案

## 1. 目标

本次改造只解决 **AI 聊天界面的渲染问题**，不通过提示词约束模型，也不修改模型原始输出事实顺序。

目标：

- 任意数量图片都能自然显示。
- 任意横图、竖图、方图、超宽图、超高图都能自适应。
- 保持模型输出顺序不变。
- 短文字与图片可以采用更紧凑的二维排版。
- 连续图片避免纵向无限拉长。
- 多图可以使用图片堆叠进入 Lyra Workspace。
- 聊天区负责“快速阅读”，Workspace 负责“完整查看和操作”。
- 桌面、窄窗口、移动端都能自动降级。
- 不要求模型知道任何布局细节。

---

## 2. 核心原则

### 2.1 不修改内容顺序

模型原始输出：

```text
文字 A
图片 A
文字 B
图片 B
图片 C
文字 C
```

语义顺序始终保持：

```text
文字 A → 图片 A → 文字 B → 图片 B → 图片 C → 文字 C
```

允许改变的是：

- 宽度
- 高度
- 对齐方式
- 左右排布
- 环绕
- 图片预览方式
- 连续图片的视觉容器

禁止为了排版把后面的图片移动到前面。

---

### 2.2 排版属于 Renderer，不属于 LLM

LLM 只输出内容。

Renderer 根据以下信息决定布局：

```text
内容类型
图片原始宽高
图片宽高比
图片数量
相邻文字实际高度
容器宽度
视口尺寸
Workspace 状态
```

模型不输出：

```json
{
  "size": "large",
  "layout": "mosaic"
}
```

这些都由前端自动判断。

---

## 3. 总体架构

```text
LLM Stream
   ↓
Markdown / Rich Content Parser
   ↓
Content AST
   ↓
Media Segment Detector
   ↓
Layout Resolver
   ↓
Adaptive Media Renderer
   ↓
Chat View / Workspace
```

推荐拆成四层：

```text
Content
Grouping
Layout
Rendering
```

### Content

识别：

- paragraph
- heading
- image
- image-caption
- video
- file
- code
- table
- card

### Grouping

只做结构识别，不改变顺序：

- 单图
- 连续图片
- 短文字 + 图片
- 图片 + 短文字
- 图片组
- 普通正文

### Layout

根据约束选择：

- inline
- wide
- side-flow
- media-stack
- justified-row
- mobile-flow

### Rendering

最终交给 React / Electron UI 渲染。

---

# 4. 图片基础模型

建议统一图片节点：

```ts
interface ImageNode {
  id: string
  src: string

  intrinsicWidth?: number
  intrinsicHeight?: number
  aspectRatio?: number

  alt?: string
  caption?: string

  sourceUrl?: string

  loadState:
    | "pending"
    | "loaded"
    | "failed"
}
```

加载成功后计算：

```ts
aspectRatio = intrinsicWidth / intrinsicHeight
```

---

# 5. 图片宽高比分类

不要使用简单的：

```text
LARGE
SMALL
```

改成连续比例计算，只保留分类用于快速决策。

```ts
if (ratio >= 2.2) ultraWide
else if (ratio >= 1.35) landscape
else if (ratio >= 0.8) squareLike
else if (ratio >= 0.55) portrait
else ultraTall
```

建议：

| 类型 | 比例 |
|---|---:|
| ultraWide | >= 2.2 |
| landscape | 1.35–2.2 |
| squareLike | 0.8–1.35 |
| portrait | 0.55–0.8 |
| ultraTall | < 0.55 |

---

# 6. 单张图片渲染

## 6.1 普通横图

默认：

```text
正文
┌────────────────────────────┐
│                            │
│           图片             │
│                            │
└────────────────────────────┘
caption
```

约束：

```css
max-width: 100%;
height: auto;
```

不要固定成统一高度。

---

## 6.2 超宽图

对于：

```text
ratio >= 2.2
```

允许使用更宽的展示区域：

```text
      正文宽度
        ↓

   普通正文普通正文

┌──────────────────────────────┐
│          超宽图片            │
└──────────────────────────────┘
```

如果聊天正文宽度允许，可轻微突破正文列，但不能突破主聊天容器。

---

## 6.3 竖图 / 超高图

这是最容易破坏聊天体验的情况。

不要：

```text
┌───────┐
│       │
│       │
│       │
│       │
│       │
│       │
│       │
└───────┘
```

建议：

```css
max-height: min(65vh, 720px);
width: auto;
object-fit: contain;
```

点击后 Workspace 显示完整尺寸。

聊天区只是预览，不承担完整查看职责。

---

## 6.4 很小的图片

如果图片本身分辨率很低：

```text
intrinsicWidth < 400
```

不要强制拉满聊天区。

例如：

```text
┌──────────┐
│   图片   │
└──────────┘
```

而不是：

```text
┌────────────────────────────┐
│      被强制放大的图片      │
└────────────────────────────┘
```

建议：

```css
width: min(intrinsicWidth, availableWidth);
```

---

# 7. 短文字 + 图片

这是此次改造的重点之一。

模型输出顺序：

```text
一句短文字
图片
```

语义顺序不能改变，但视觉上可以形成 side-flow。

例如：

```text
这是巴黎埃菲尔铁塔。   ┌─────────────┐
                       │             │
                       │    图片     │
                       │             │
                       └─────────────┘
```

仍然是：

```text
文字 → 图片
```

只是处于同一个二维布局上下文。

---

## 7.1 是否进入 Side Flow

不要根据字符数直接判断。

先测量真实高度：

```ts
textHeight
imagePreviewHeight
containerWidth
```

推荐条件：

```text
文字高度 <= 3 行
AND
图片不是 ultraWide
AND
桌面可用宽度 >= 720px
```

则允许：

```text
side-flow
```

否则：

```text
normal-flow
```

---

## 7.2 图片 + 短文字

同理：

```text
图片
一句短说明
```

可渲染：

```text
┌──────────────┐
│              │   一句短说明
│     图片     │
│              │
└──────────────┘
```

阅读顺序仍为：

```text
图片 → 文字
```

DOM 顺序也保持一致。

推荐优先使用 CSS Grid，而不是真正 float。

---

# 8. 连续图片识别

定义：

```text
图片
图片
图片
```

或者：

```text
图片 + caption
图片 + caption
图片 + caption
```

中间没有正文 paragraph 时，视为一个连续图片区段。

---

## 8.1 不允许跨正文合并

下面不能合并：

```text
图片 A

这里是一段正文。

图片 B
```

必须断开。

---

# 9. 连续图片：MediaStack

这是 Lyra 推荐的默认方案。

当：

```text
连续图片 >= 3
```

聊天区优先进入：

```text
MediaStack
```

例如：

```text
┌─────────────────────┐
│                     │
│       图片 1        │
│                     │
└─────────────────────┘╲
  └─────────────────────┘╲
    └─────────────────────┘   +4
```

优点：

- 不拉长聊天记录
- 顺序不变
- 非常适合 Agent 输出
- 与 Workspace 深度结合
- 可以容纳任意宽高比图片
- 不需要模型做任何判断

---

# 10. MediaStack 规则

建议：

```text
1 张
→ Single Image

2 张
→ Pair / Small Stack

3–8 张
→ MediaStack

>8 张
→ MediaStack + count badge
```

例如：

```text
+8
```

---

## 10.1 Stack 表面展示

显示：

- 第一张图
- 第二张轻微偏移
- 第三张轻微偏移
- 图片数量

不建议真实堆叠全部 N 张 DOM。

最多渲染：

```text
3 层视觉卡片
```

避免性能浪费。

---

## 10.2 Stack 不裁掉原始信息

Stack 只是 Preview。

允许：

```css
object-fit: cover;
```

但必须：

- 明确这是预览
- 点击进入 Workspace
- Workspace 使用 `contain`
- Workspace 可以查看完整图片

---

# 11. 两张连续图片

两张图片不一定要 Stack。

优先：

```text
┌──────────────┬──────────────┐
│              │              │
│    图片 1    │    图片 2    │
│              │              │
└──────────────┴──────────────┘
```

如果宽高比差距很大：

```text
横图 + 超高竖图
```

则可使用轻堆叠：

```text
┌────────────────────┐
│      图片 1        │
└────────────────────┘╲
  └───────────────────┘
```

或者保持上下流。

---

# 12. Justified Layout

作为 MediaStack 之外的第二种多图方案。

适合：

- 搜索结果图片
- 商品结果
- 图片浏览型回答
- 用户明确需要同时看到所有图片

效果类似 Flickr / Google Photos：

```text
┌───────────────┬──────────┐
│               │          │
│     横图      │  方图    │
│               │          │
├────────┬──────┴──────────┤
│ 竖图   │      宽图       │
│        │                 │
└────────┴─────────────────┘
```

必须严格保持：

```text
左 → 右
上 → 下
```

等于原始图片顺序。

---

# 13. Justified Row 算法

图片比例：

```text
r1 = w1 / h1
r2 = w2 / h2
r3 = w3 / h3
```

容器宽度：

```text
W
```

图片间距总和：

```text
G
```

则：

```text
rowHeight =
(W - G) / (r1 + r2 + r3)
```

每张图片宽度：

```text
imageWidth =
rowHeight × aspectRatio
```

这样：

- 不裁图
- 不变形
- 不改变图片顺序
- 自动填满一行

---

# 14. Stack 与 Justified 的选择

默认：

```text
聊天型回答
→ MediaStack

图片浏览型回答
→ Justified
```

可简单判断：

### MediaStack

适合：

```text
正文中偶尔连续出现多图
Agent 返回附件
截图组
设计图
分析图片
```

### Justified

适合：

```text
图片搜索
“给我看看几种……”
图库
照片推荐
图片本身就是回答主体
```

---

# 15. Workspace 图片查看器

点击：

```text
Single Image
Pair
MediaStack
Justified Item
```

统一进入 Workspace。

---

## 15.1 Workspace 基础结构

```text
Chat                         Workspace

正文                         2 / 8

[MediaStack +8]              ┌──────────────────────┐
                             │                      │
正文                         │       图片 2         │
                             │                      │
                             └──────────────────────┘

                             ← Prev        Next →
```

---

## 15.2 Workspace 功能

必须支持：

```text
上一张 / 下一张
键盘 ← →
鼠标滚轮切换
触控板切换
缩放
拖动
100%
适应窗口
查看原图
复制图片
保存图片
复制图片链接
查看来源
```

后续可支持：

```text
让 Agent 分析当前图片
OCR
图片编辑
标注
对比两张图片
```

---

# 16. Workspace 图片组状态

聊天中的一个 Stack 应有：

```ts
interface MediaGroup {
  id: string
  items: ImageNode[]
  activeIndex: number
}
```

打开：

```ts
openWorkspace({
  type: "image-group",
  groupId,
  activeIndex: clickedIndex
})
```

这样从第二张图点击进去，Workspace 直接打开第二张。

---

# 17. Caption 处理

Caption 必须跟图片绑定。

数据结构：

```ts
{
  image,
  caption
}
```

而不是：

```text
ImageNode
ParagraphNode
```

否则进入 Stack 后 caption 会丢失。

Workspace 切换图片时：

```text
Image 1
Caption 1

↓

Image 2
Caption 2
```

同步切换。

---

# 18. 响应式规则

## Desktop

```text
>= 900px
```

允许：

- Side Flow
- Pair
- MediaStack
- Justified
- Wide Image

---

## Narrow Desktop

```text
600–900px
```

减少：

- side-flow 使用频率
- pair 最大尺寸
- stack 偏移量

---

## Mobile

```text
< 600px
```

默认关闭复杂左右混排。

保留：

```text
Single
MediaStack
Horizontal Gallery
Vertical Flow
```

不要为了桌面效果在手机强行压缩文字。

---

# 19. 推荐决策流程

```text
遇到图片节点
   ↓
是否连续多图？
   │
   ├─ 否
   │   ↓
   │ 是否存在短相邻文字？
   │   │
   │   ├─ 是 → Side Flow
   │   └─ 否 → Normal Image
   │
   └─ 是
       ↓
   图片数量？
       │
       ├─ 2 → Pair / Small Stack
       │
       └─ >=3
            ↓
       当前内容是否以“浏览图片”为主？
            │
            ├─ 是 → Justified
            └─ 否 → MediaStack
```

---

# 20. 文本测量

不要：

```ts
if (text.length < 50)
```

应该：

```ts
measureTextLayout()
```

得到：

```ts
{
  width,
  height,
  lineCount
}
```

真正用于决策的是：

```text
lineCount
renderHeight
```

而不是字符数。

---

# 21. Streaming 场景

AI 输出是流式的，所以布局不能频繁跳动。

推荐两阶段。

## 阶段 1：流式占位

图片 metadata 未到：

```text
┌────────────────────┐
│     loading...     │
└────────────────────┘
```

使用稳定的预估比例。

---

## 阶段 2：图片信息到达

拿到：

```text
naturalWidth
naturalHeight
```

后再进行一次最终布局。

避免：

```text
图片加载一次
布局跳一次
caption 到达
再跳一次
下一张图加载
再跳一次
```

应该做：

```text
debounce layout resolve
```

例如：

```text
50–120ms
```

批量更新。

---

# 22. 防止布局跳动

图片必须尽早写入：

```css
aspect-ratio
```

例如：

```css
aspect-ratio: 16 / 9;
```

加载之前就预留空间。

---

# 23. 动画

布局变化：

```text
150–220ms
```

建议只动画：

```text
transform
opacity
```

避免大量：

```text
height
width
top
left
```

造成 layout thrashing。

---

# 24. 性能

长聊天可能存在数百张图片。

建议：

```text
IntersectionObserver
Lazy Loading
Virtualized Message List
Thumbnail Cache
Workspace 原图按需加载
```

聊天区优先加载：

```text
thumbnail
```

Workspace 再加载：

```text
full resolution
```

---

# 25. 图片失败处理

加载失败不能留下巨大空白。

显示：

```text
┌──────────────────────┐
│ 图片加载失败         │
│ 重新加载    打开来源 │
└──────────────────────┘
```

如果 Stack 中一张失败：

```text
保留该索引
```

不要删除节点，否则图片编号会改变。

---

# 26. Accessibility

必须支持：

```text
alt
keyboard navigation
focus
ARIA
reduced-motion
```

Stack：

```text
“包含 6 张图片，按 Enter 打开”
```

Workspace：

```text
“第 2 张，共 6 张”
```

---

# 27. 推荐组件结构

```text
components/
  media/
    AdaptiveImage.tsx
    MediaPair.tsx
    MediaStack.tsx
    JustifiedGallery.tsx
    SideFlow.tsx
    MediaCaption.tsx

  workspace/
    ImageWorkspace.tsx
    ImageToolbar.tsx
    ImageNavigator.tsx

  layout/
    MediaLayoutResolver.ts
    MediaSegmentDetector.ts
    textMeasure.ts
```

---

# 28. 推荐类型

```ts
type MediaLayout =
  | "single"
  | "wide"
  | "side-flow"
  | "pair"
  | "stack"
  | "justified"
```

---

# 29. Layout Resolver

示例：

```ts
function resolveMediaLayout(
  segment: MediaSegment,
  context: LayoutContext
): MediaLayout {
  if (segment.images.length >= 3) {
    if (segment.intent === "gallery") {
      return "justified"
    }

    return "stack"
  }

  if (segment.images.length === 2) {
    return "pair"
  }

  if (
    segment.images.length === 1 &&
    context.viewportWidth >= 720 &&
    segment.adjacentText?.lineCount <= 3
  ) {
    return "side-flow"
  }

  if (
    segment.images.length === 1 &&
    segment.images[0].aspectRatio >= 2.2
  ) {
    return "wide"
  }

  return "single"
}
```

这里的 `intent` 最好来自系统自己判断，而不是 LLM 指定。

---

# 30. 不建议采用的方案

## 不建议 1：LARGE / SMALL

问题：

```text
信息太粗糙
无法解决连续图片
无法解决横竖混合
无法解决超高图
```

---

## 不建议 2：全部 Masonry

Masonry 容易让视觉阅读顺序变得不明确。

对于 AI 回答，顺序比视觉填充率更重要。

---

## 不建议 3：让模型输出 layout

例如：

```json
{
  "layout": "grid"
}
```

会导致：

- 模型不稳定
- 不同模型行为不一致
- 流式输出难处理
- 业务逻辑进入 Prompt

---

## 不建议 4：所有图片都 full width

这是目前 AI 聊天界面最常见的问题之一。

尤其：

```text
短文字
大图
短文字
大图
```

会产生极差的纵向效率。

---

## 不建议 5：通过改变内容顺序解决布局

禁止：

```text
A
图片 A
B
图片 B
```

变成：

```text
A
B
图片 A 图片 B
```

这属于修改回答结构，而不是渲染。

---

# 31. 第一阶段 MVP

先只实现五个能力：

```text
1. 图片宽高比识别
2. 单图自适应尺寸
3. 短文字 + 单图 Side Flow
4. 连续 >=3 图 MediaStack
5. Workspace 图片组浏览
```

这五项完成以后，体验就会比现在明显好很多。

---

# 32. 第二阶段

增加：

```text
Pair
Justified Gallery
Mobile Adaptive
Caption Association
Streaming Stabilization
Thumbnail / Original Image Pipeline
```

---

# 33. 第三阶段

把同一个 Composition Engine 扩展到：

```text
视频
地图
搜索结果
文件
PDF
代码预览
网页卡片
图表
音频
```

最终变成：

```text
Adaptive Response Composition Engine
```

而不只是 Image Renderer。

---

# 34. 最终推荐规则

Lyra 图片渲染默认策略：

```text
单图
→ 自适应比例显示

短文字 + 单图
→ Side Flow

连续两图
→ Pair

连续三图及以上
→ MediaStack

图片浏览型内容
→ Justified Gallery

超高图片
→ 限制聊天区高度，Workspace 完整查看

所有图片
→ 保持原始顺序

所有完整查看
→ Workspace
```

---

# 35. 最终目标

Lyra 不再把 AI 输出理解为：

```text
一串 Markdown block
```

而是：

```text
一个有顺序的内容流
```

Renderer 在保持顺序和语义不变的前提下，根据：

```text
图片比例
文字高度
图片数量
可用空间
设备宽度
内容类型
```

实时求出更自然的二维布局。

聊天区：

> 快速、紧凑、连续阅读。

Workspace：

> 放大、浏览、切换、操作。

这套结构既解决当前的多尺寸图片问题，也为 Lyra 后续所有富媒体输出提供统一基础。
