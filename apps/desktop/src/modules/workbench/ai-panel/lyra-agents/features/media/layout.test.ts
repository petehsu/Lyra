import { describe, expect, it } from "vitest";

import {
  classifyAspect,
  figureCopy,
  groupMediaCardRuns,
  isCompactText,
  isShortText,
  isWrapText,
  mediaCardColumnCount,
  resolveMediaLayout,
  scanMarkdownMediaTokens,
  shouldFrameGallery,
  SIDE_FLOW_MIN_WIDTH,
  splitTrailingPairText,
  type MediaImage,
  type MediaToken
} from "./layout";

const image = (
  id: string,
  size?: { readonly width: number; readonly height: number }
): MediaImage => ({
  id,
  src: `https://example.com/${id}.png`,
  ...(size === undefined
    ? {}
    : { intrinsicWidth: size.width, intrinsicHeight: size.height })
});

const text = (id: string, value: string): MediaToken => ({
  type: "text",
  id,
  text: value
});

const img = (media: MediaImage): MediaToken => ({
  type: "image",
  id: media.id,
  image: media
});

describe("classifyAspect", () => {
  it("classifies ratio boundaries", () => {
    expect(classifyAspect(2.2)).toBe("ultraWide");
    expect(classifyAspect(2.19)).toBe("landscape");
    expect(classifyAspect(1.35)).toBe("landscape");
    expect(classifyAspect(1.34)).toBe("squareLike");
    expect(classifyAspect(0.8)).toBe("squareLike");
    expect(classifyAspect(0.79)).toBe("portrait");
    expect(classifyAspect(0.55)).toBe("portrait");
    expect(classifyAspect(0.54)).toBe("ultraTall");
  });
});

describe("resolveMediaLayout", () => {
  it("renders one image as a single", () => {
    const segments = resolveMediaLayout([img(image("a", { width: 800, height: 600 }))]);
    expect(segments).toEqual([
      expect.objectContaining({ type: "single", image: expect.objectContaining({ id: "a" }) })
    ]);
  });

  it("pairs short text plus one image as side-flow", () => {
    const segments = resolveMediaLayout([
      text("t1", "200×200 的方图。"),
      img(image("a", { width: 200, height: 200 }))
    ]);
    expect(segments).toEqual([
      expect.objectContaining({
        type: "side-flow",
        order: "text-image",
        text: "200×200 的方图。"
      })
    ]);
  });

  it("pairs one image plus trailing short text as image-text side-flow", () => {
    const segments = resolveMediaLayout([
      img(image("a", { width: 400, height: 300 })),
      text("t1", "这是横图。")
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["side-flow"]);
    expect(segments[0]).toEqual(expect.objectContaining({ order: "image-text" }));
  });

  it("does not side-flow long text", () => {
    const long = "第一行\n第二行\n第三行\n第四行还在继续。";
    const segments = resolveMediaLayout([
      text("t1", long),
      img(image("a", { width: 400, height: 300 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "single"]);
  });

  it("wraps a long body beside one image instead of stacking a poster", () => {
    const body = [
      "这段说明需要足够长，才能配得上竖图旁边的正文栏。",
      "它会讲构图、光线、以及为什么这张图适合放在聊天预览里。",
      "同时还会补上地点、季节和拍摄时的限制，避免只剩一句标题。",
      "如果文字只有三行，算法不会把图和字拆成左右两栏。",
      "等到正文真的能站住，宽栏里才让图片靠右、文字在左顺排。",
      "窄栏仍然上下叠放，预览高度也会被限制，避免一张竖图撑满窗口。",
      "这样短说明、长说明、方图和竖图会走不同的排法。",
      "最后一行用来凑够绕排所需的正文量。"
    ].join("\n");
    const segments = resolveMediaLayout([
      text("t1", body),
      img(image("a", { width: 1080, height: 1920 }))
    ]);
    expect(segments).toEqual([
      expect.objectContaining({
        type: "side-flow",
        wrap: true,
        order: "text-image"
      })
    ]);
  });

  it("does not side-flow ultra-wide images", () => {
    const segments = resolveMediaLayout([
      text("t1", "超宽图。"),
      img(image("a", { width: 2200, height: 800 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "single"]);
  });

  it("still binds a short caption to its image in a narrow column", () => {
    const segments = resolveMediaLayout(
      [text("t1", "一句说明。"), img(image("a", { width: 400, height: 300 }))],
      { containerWidth: SIDE_FLOW_MIN_WIDTH - 1 }
    );
    expect(segments.map((segment) => segment.type)).toEqual(["side-flow"]);
    expect(segments[0]).toEqual(expect.objectContaining({
      wrap: false,
      columnPair: false
    }));
  });

  it("keeps two consecutive images as two singles that share a viewer group", () => {
    const segments = resolveMediaLayout([
      img(image("a")),
      img(image("b"))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["single", "single"]);
    expect(segments[0]).toEqual(expect.objectContaining({
      index: 0,
      group: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })]
    }));
    expect(segments[1]).toEqual(expect.objectContaining({ index: 1 }));
  });

  it("stacks three or more consecutive images", () => {
    const segments = resolveMediaLayout([
      img(image("a")),
      img(image("b")),
      img(image("c")),
      img(image("d"))
    ]);
    expect(segments).toEqual([
      expect.objectContaining({
        type: "stack",
        images: [
          expect.objectContaining({ id: "a" }),
          expect.objectContaining({ id: "b" }),
          expect.objectContaining({ id: "c" }),
          expect.objectContaining({ id: "d" })
        ]
      })
    ]);
  });

  it("does not merge images across a body paragraph", () => {
    const body = "这里是一段正文。\n第二行继续说明。\n第三行还在写。\n第四行所以这不是短说明。";
    const segments = resolveMediaLayout([
      img(image("a")),
      text("t1", body),
      img(image("b")),
      img(image("c")),
      img(image("d"))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual([
      "single",
      "text",
      "stack"
    ]);
  });

  it("treats blank text between images as still consecutive", () => {
    const segments = resolveMediaLayout([
      img(image("a")),
      text("gap", "\n\n"),
      img(image("b")),
      text("gap2", "   "),
      img(image("c"))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["stack"]);
  });

  it("repeats side-flow for caption-plus-image pairs", () => {
    const segments = resolveMediaLayout([
      text("t1", "200×200。"),
      img(image("a", { width: 200, height: 200 })),
      text("t2", "400×300。"),
      img(image("b", { width: 400, height: 300 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["side-flow", "side-flow"]);
  });

  it("keeps an intro paragraph above side-flow numbered captions", () => {
    const segments = resolveMediaLayout([
      text("t1", "好的，给你放几张图：\n\n1. 200x200 小方形"),
      img(image("a", { width: 200, height: 200 })),
      text("t2", "2. 400x300 小横图"),
      img(image("b", { width: 400, height: 300 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "side-flow", "side-flow"]);
    expect(segments[0]).toEqual(expect.objectContaining({ text: "好的，给你放几张图：" }));
    expect(segments[1]).toEqual(expect.objectContaining({
      type: "side-flow",
      text: "1. 200x200 小方形"
    }));
  });

  it("puts a fact list beside the image and keeps the intro and follow-up full width", () => {
    const info = [
      "具体信息：",
      "- 作者：Alexis B",
      "- 地点：Nancy, Grand Est, France",
      "- 描述：Black and white photograph of people walking with umbrellas on a rainy street in Nancy, France.",
      "- 尺寸：2072x2072，正方形，2024年11月5日发布",
      "- 链接：https://www.pexels.com/photo/example/"
    ].join("\n");
    const segments = resolveMediaLayout([
      text("t1", `你链接的这张是 Pexels 上的一张黑白街拍：法国南希雨天的街景。\n\n${info}`),
      img(image("a", { width: 2072, height: 2072 })),
      text("t2", "和你现在打开的那张塞尔黑白雨伞过街图是同一个作者，风格很像，都是黑白雨天 + 伞。")
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "side-flow", "text"]);
    expect(segments[0]).toEqual(expect.objectContaining({
      text: "你链接的这张是 Pexels 上的一张黑白街拍：法国南希雨天的街景。"
    }));
    expect(segments[1]).toEqual(expect.objectContaining({
      type: "side-flow",
      order: "image-text",
      wrap: false,
      columnPair: true,
      text: info
    }));
    expect(segments[2]).toEqual(expect.objectContaining({
      type: "text",
      text: "和你现在打开的那张塞尔黑白雨伞过街图是同一个作者，风格很像，都是黑白雨天 + 伞。"
    }));
    expect(groupMediaCardRuns(segments).map((run) => run.type)).toEqual(["item", "figure-row", "item"]);
  });
});

describe("splitTrailingPairText", () => {
  it("keeps a lead paragraph out of a trailing compact list", () => {
    const list = "具体信息：\n- 作者：Alexis B\n- 尺寸：2072x2072";
    expect(splitTrailingPairText(`法国南希雨天的街景。\n\n${list}`, 720)).toEqual({
      lead: "法国南希雨天的街景。",
      trailing: list
    });
  });

  it("splits a short last caption away from preceding copy", () => {
    const source = [
      "来源：Unsplash photo-1441974231531-c6227db76b6e，已裁剪为竖长幅 1080×1920 原始链接：",
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1080&h=1920&fit=crop&q=80"
    ].join("\n");
    expect(splitTrailingPairText(`${source}\n\n备用竖长图：`, 720)).toEqual({
      lead: source,
      trailing: "备用竖长图："
    });
  });

  it("treats markdown lists as compact regardless of label language", () => {
    expect(isCompactText("- alpha\n- beta\n- gamma", 720)).toBe(true);
    expect(isCompactText("一段普通说明。", 720)).toBe(false);
  });
});

describe("groupMediaCardRuns", () => {
  it("packs consecutive captioned images in output order, leaving the intro as its own block", () => {
    const segments = resolveMediaLayout([
      text("intro", "给你几张图。"),
      text("t1", "第一张。"),
      img(image("a", { width: 200, height: 200 })),
      text("t2", "第二张。"),
      img(image("b", { width: 400, height: 300 })),
      text("t3", "第三张。"),
      img(image("c", { width: 800, height: 600 }))
    ]);
    const runs = groupMediaCardRuns(segments);
    expect(runs.map((run) => run.type)).toEqual(["item", "figure-row"]);
    expect(runs[0]).toEqual(expect.objectContaining({
      type: "item",
      segment: expect.objectContaining({ type: "text", text: "给你几张图。" })
    }));
    expect(runs[1]?.type === "figure-row" ? runs[1].segments.map((segment) => segment.type) : []).toEqual([
      "side-flow",
      "side-flow",
      "side-flow"
    ]);
  });

  it("does not wrap a single captioned image as a card grid", () => {
    const segments = resolveMediaLayout([
      text("t1", "只有一张。"),
      img(image("a", { width: 400, height: 300 }))
    ]);
    expect(groupMediaCardRuns(segments).map((run) => run.type)).toEqual(["figure-row"]);
  });

  it("keeps mixed-aspect captioned images in a coordinating card grid", () => {
    const segments = resolveMediaLayout([
      text("t1", "方图。"),
      img(image("a", { width: 200, height: 200 })),
      text("t2", "竖图。"),
      img(image("b", { width: 600, height: 900 })),
      text("t3", "宽图。"),
      img(image("c", { width: 1600, height: 900 }))
    ]);
    expect(groupMediaCardRuns(segments).map((run) => run.type)).toEqual(["cards"]);
  });

  it("packs two consecutive uncaptioned images in output order", () => {
    const segments = resolveMediaLayout([
      img(image("a")),
      img(image("b"))
    ]);
    const runs = groupMediaCardRuns(segments);
    expect(runs).toEqual([
      expect.objectContaining({
        type: "figure-row",
        segments: [
          expect.objectContaining({ type: "single", image: expect.objectContaining({ id: "a" }) }),
          expect.objectContaining({ type: "single", image: expect.objectContaining({ id: "b" }) })
        ]
      })
    ]);
  });

  it("does not put a mixed pair into a coordinating card grid", () => {
    const segments = resolveMediaLayout([
      text("t1", "方图。"),
      img(image("a", { width: 200, height: 200 })),
      text("t2", "竖图。"),
      img(image("b", { width: 600, height: 900 }))
    ]);
    expect(groupMediaCardRuns(segments).map((run) => run.type)).toEqual(["figure-row"]);
  });

  it("does not pack consecutive ultra-wide images into a coordinating grid", () => {
    const segments = resolveMediaLayout([
      img(image("a", { width: 3840, height: 1080 })),
      img(image("b", { width: 3200, height: 900 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["single", "single"]);
    expect(groupMediaCardRuns(segments).map((run) => run.type)).toEqual(["item", "item"]);
  });

  it("binds sandwiched source copy to the preceding portrait and rows the next matching figure", () => {
    const source = [
      "来源：Unsplash photo-1441974231531-c6227db76b6e，已裁剪为竖长幅 1080×1920 原始链接：",
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1080&h=1920&fit=crop&q=80"
    ].join("\n");
    const segments = resolveMediaLayout([
      text("t1", "已找到一张竖长图 (1080×1920, 9:16)："),
      img(image("a", { width: 1080, height: 1920 })),
      text("t2", `${source}\n\n备用竖长图：`),
      img(image("b", { width: 1080, height: 1920 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "side-flow", "side-flow"]);
    expect(segments[0]).toEqual(expect.objectContaining({
      type: "text",
      text: "已找到一张竖长图 (1080×1920, 9:16)："
    }));
    expect(segments[1]).toEqual(expect.objectContaining({
      type: "side-flow",
      columnPair: false,
      text: source
    }));
    expect(segments[2]).toEqual(expect.objectContaining({
      type: "side-flow",
      text: "备用竖长图："
    }));
    const runs = groupMediaCardRuns(segments);
    expect(runs.map((run) => run.type)).toEqual(["item", "figure-row"]);
    expect(runs[1]?.type === "figure-row" ? runs[1].segments.map((segment) => segment.image.id) : []).toEqual([
      "a",
      "b"
    ]);
  });

  it("does not glue a follow-up question onto the last gallery tile", () => {
    const followUp = "看看加载、缩放和排版是否正常？需要我再加一组比如 100x100 超小图也可以直接加。";
    const segments = resolveMediaLayout([
      text("t1", "好的，给你放几张图：\n\n1. 200x200 小方形"),
      img(image("a", { width: 200, height: 200 })),
      text("t2", "2. 400x300 小横图"),
      img(image("b", { width: 400, height: 300 })),
      text("t3", "3. 800x600 中等横图"),
      img(image("c", { width: 800, height: 600 })),
      text("t4", "4. 1200x800 大横图"),
      img(image("d", { width: 1200, height: 800 })),
      text("t5", "5. 600x900 竖图"),
      img(image("e", { width: 600, height: 900 })),
      text("t6", "6. 1920x1080 超大宽图"),
      img(image("f", { width: 1920, height: 1080 })),
      text("t7", followUp)
    ]);
    expect(segments.map((segment) => segment.type)).toEqual([
      "text",
      "side-flow",
      "side-flow",
      "side-flow",
      "side-flow",
      "side-flow",
      "side-flow",
      "text"
    ]);
    expect(segments[7]).toEqual(expect.objectContaining({ type: "text", text: followUp }));
    expect(segments[6]).toEqual(expect.objectContaining({
      type: "side-flow",
      text: "6. 1920x1080 超大宽图"
    }));
  });

  it("keeps a follow-up after a gallery even in a narrow chat column", () => {
    const followUp = "看看加载、缩放和排版是否正常？需要我再加一组比如 100x100 超小图也可以直接加。";
    const segments = resolveMediaLayout(
      [
        text("t1", "好的，给你放几张图：\n\n1. 200x200 小方形"),
        img(image("a", { width: 200, height: 200 })),
        text("t2", "2. 400x300 小横图"),
        img(image("b", { width: 400, height: 300 })),
        text("t3", "3. 800x600 中等横图"),
        img(image("c", { width: 800, height: 600 })),
        text("t4", "4. 1200x800 大横图"),
        img(image("d", { width: 1200, height: 800 })),
        text("t5", "5. 600x900 竖图"),
        img(image("e", { width: 600, height: 900 })),
        text("t6", "6. 1920x1080 超大宽图"),
        img(image("f", { width: 1920, height: 1080 })),
        text("t7", followUp)
      ],
      { containerWidth: 360 }
    );
    expect(segments[segments.length - 1]).toEqual(expect.objectContaining({
      type: "text",
      text: followUp
    }));
    expect(segments.some((segment) => (
      segment.type === "side-flow" && figureCopy(segment).includes("看看加载")
    ))).toBe(false);
    expect(groupMediaCardRuns(segments).map((run) => run.type)).toEqual(["item", "cards", "item"]);
  });
});

describe("mediaCardColumnCount", () => {
  it("adds columns as the chat column grows instead of stopping at two", () => {
    expect(mediaCardColumnCount(300, 6)).toBe(1);
    expect(mediaCardColumnCount(400, 6)).toBe(2);
    expect(mediaCardColumnCount(700, 6)).toBe(3);
    expect(mediaCardColumnCount(800, 6)).toBe(3);
    expect(mediaCardColumnCount(900, 6)).toBe(4);
  });

  it("does not create more columns than cards", () => {
    expect(mediaCardColumnCount(900, 2)).toBe(2);
  });
});

describe("shouldFrameGallery", () => {
  it("frames a mixed-aspect set so the tiles can share one grid", () => {
    expect(shouldFrameGallery([
      image("a", { width: 200, height: 200 }),
      image("b", { width: 400, height: 300 }),
      image("c", { width: 600, height: 900 }),
      image("d", { width: 3840, height: 1080 })
    ])).toBe(true);
  });

  it("does not put a single image, a pair, or a homogeneous set into a coordinating slot", () => {
    expect(shouldFrameGallery([image("a", { width: 3840, height: 1080 })])).toBe(false);
    expect(shouldFrameGallery([
      image("a", { width: 200, height: 200 }),
      image("b", { width: 600, height: 900 })
    ])).toBe(false);
    expect(shouldFrameGallery([
      image("a", { width: 3840, height: 1080 }),
      image("b", { width: 3200, height: 1000 })
    ])).toBe(false);
    expect(shouldFrameGallery([
      image("a", { width: 1080, height: 1920 }),
      image("b", { width: 1080, height: 1920 })
    ])).toBe(false);
  });
});

describe("scanMarkdownMediaTokens", () => {
  it("extracts standalone markdown images and leaves surrounding text", () => {
    const tokens = scanMarkdownMediaTokens(
      "200×200 的方图。\n\n![square](https://example.com/a.png)\n"
    );
    expect(tokens.map((token) => token.type)).toEqual(["text", "image"]);
    expect(resolveMediaLayout(tokens).map((segment) => segment.type)).toEqual(["side-flow"]);
  });

  it("stacks consecutive markdown images", () => {
    const tokens = scanMarkdownMediaTokens(
      "![a](https://example.com/a.png)\n![b](https://example.com/b.png)\n![c](https://example.com/c.png)"
    );
    expect(resolveMediaLayout(tokens).map((segment) => segment.type)).toEqual(["stack"]);
  });

  it("does not extract images inside fenced code", () => {
    const tokens = scanMarkdownMediaTokens(
      "```md\n![nope](https://example.com/nope.png)\n```\n\n![yes](https://example.com/yes.png)"
    );
    expect(tokens.filter((token) => token.type === "image")).toHaveLength(1);
    expect(tokens.some((token) => token.type === "text" && token.text.includes("![nope]"))).toBe(true);
  });

  it("turns numbered captions plus following images into repeated side-flow", () => {
    const tokens = scanMarkdownMediaTokens(
      [
        "好的，给你放几张图：",
        "",
        "1. 200x200 小方形",
        "![a](https://example.com/a.png)",
        "2. 400x300 小横图",
        "![b](https://example.com/b.png)",
        "3. 800x600 中等横图",
        "![c](https://example.com/c.png)"
      ].join("\n")
    );
    expect(tokens.map((token) => token.type)).toEqual([
      "text",
      "image",
      "text",
      "image",
      "text",
      "image"
    ]);
    expect(resolveMediaLayout(tokens).map((segment) => segment.type)).toEqual([
      "text",
      "side-flow",
      "side-flow",
      "side-flow"
    ]);
  });

  it("places markdown fact lists beside the following image", () => {
    const tokens = scanMarkdownMediaTokens(
      [
        "你链接的这张是 Pexels 上的一张黑白街拍：法国南希雨天的街景。",
        "",
        "具体信息：",
        "- 作者：Alexis B",
        "- 地点：Nancy, Grand Est, France",
        "- 尺寸：2072x2072，正方形",
        "- 链接：https://www.pexels.com/photo/example/",
        "",
        "![street](https://example.com/nancy.png)",
        "",
        "和你现在打开的那张是同一个作者。"
      ].join("\n")
    );
    expect(resolveMediaLayout(tokens).map((segment) => segment.type)).toEqual([
      "text",
      "side-flow",
      "text"
    ]);
    expect(resolveMediaLayout(tokens)[1]).toEqual(expect.objectContaining({
      type: "side-flow",
      order: "image-text",
      wrap: false,
      columnPair: true
    }));
  });
});

describe("isShortText", () => {
  it("rejects fenced code and headings", () => {
    expect(isShortText("```ts\nconst x = 1\n```", 720)).toBe(false);
    expect(isShortText("# Title", 720)).toBe(false);
    expect(isShortText("一句说明。", 720)).toBe(true);
  });
});

describe("isWrapText", () => {
  it("requires a full body, not a caption", () => {
    expect(isWrapText("已找到一张竖长图。", 720)).toBe(false);
    expect(isWrapText([
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "七",
      "八"
    ].join("\n"), 720)).toBe(true);
  });
});
