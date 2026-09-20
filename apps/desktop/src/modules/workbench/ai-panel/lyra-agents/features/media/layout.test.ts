import { describe, expect, it } from "vitest";

import {
  applyImageSizes,
  canFillWidth,
  classifyAspect,
  figureCopy,
  groupMediaCardRuns,
  isBannerImage,
  isCompactIntrinsicImage,
  isCompactText,
  isShortText,
  isWrapText,
  mediaCardColumnCount,
  letterboxWaste,
  resolveMediaLayout,
  scanMarkdownMediaTokens,
  sharedSlotRatio,
  shouldFrameGallery,
  shouldShareRow,
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

const cardsSlotRatio = (
  run: ReturnType<typeof groupMediaCardRuns>[number] | undefined
): number => {
  if (run?.type !== "cards" || run.slotRatio === undefined) {
    return Number.NaN;
  }
  return run.slotRatio.width / run.slotRatio.height;
};

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

  it("does not side-flow a lone ultra-wide image", () => {
    const segments = resolveMediaLayout([
      text("t1", "超宽图。"),
      img(image("a", { width: 2200, height: 800 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "single"]);
  });

  it("rows a 3:1 photo with a 2:1 thumb so the thumb is not blown up alone", () => {
    const wide = image("wide", { width: 600, height: 200 });
    const thumb = image("thumb", { width: 120, height: 60 });
    const segments = resolveMediaLayout([
      text("t1", "图片："),
      img(wide),
      text("t2", "图片带链接："),
      img(thumb)
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["side-flow", "side-flow"]);
    expect(segments[0]).toEqual(expect.objectContaining({
      type: "side-flow",
      order: "text-image",
      text: "图片："
    }));
    expect(segments[1]).toEqual(expect.objectContaining({
      type: "side-flow",
      order: "text-image",
      text: "图片带链接："
    }));
    const runs = groupMediaCardRuns(segments);
    expect(runs.map((run) => run.type)).toEqual(["cards"]);
    expect(cardsSlotRatio(runs[0])).toBeCloseTo(Math.sqrt(6), 2);
    expect(isBannerImage(wide)).toBe(true);
    expect(isBannerImage(thumb)).toBe(true);
    expect(canFillWidth(thumb, 720)).toBe(false);
    expect(canFillWidth(wide, 720)).toBe(true);
    expect(shouldShareRow(wide, thumb, 720)).toBe(true);
    expect(isCompactIntrinsicImage(thumb)).toBe(false);
    expect(isCompactIntrinsicImage(image("square", { width: 200, height: 200 }))).toBe(true);
    expect(isBannerImage(image("photo", { width: 1920, height: 1080 }))).toBe(false);
  });

  it("keeps two sharp cinematic banners stacked instead of shrinking them into tiles", () => {
    const segments = resolveMediaLayout([
      text("t1", "左幅。"),
      img(image("a", { width: 3840, height: 1080 })),
      text("t2", "右幅。"),
      img(image("b", { width: 3200, height: 900 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "single", "text", "single"]);
    expect(groupMediaCardRuns(segments).map((run) => run.type)).toEqual([
      "item",
      "item",
      "item",
      "item"
    ]);
  });

  it("still side-flows a 16:9 photo with a short caption", () => {
    const segments = resolveMediaLayout([
      text("t1", "一张风景。"),
      img(image("a", { width: 1920, height: 1080 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["side-flow"]);
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

  it("does not squeeze a long unsplash source URL into a skinny column beside a square", () => {
    const source = [
      "来源：Unsplash photo-1686744838136-4627383403fb，已裁剪为方形 1080×1080 原始链接：",
      "https://images.unsplash.com/photo-1686744838136-4627383403fb?w=1080&h=1080&fit=crop&q=80"
    ].join("\n");
    const segments = resolveMediaLayout([
      text("t1", `已找到一张方形尺寸图 (1080×1080，1:1)：\n\n${source}`),
      img(image("a", { width: 1080, height: 1080 }))
    ]);
    const paired = segments.find((segment) => segment.type === "side-flow");
    expect(paired === undefined || (paired.type === "side-flow" && paired.columnPair === false)).toBe(true);
    expect(groupMediaCardRuns(segments).some((run) => (
      run.type === "figure-row" && run.segments.length > 1
    ))).toBe(false);
  });

  it("does not glue the next image's label onto the previous square", () => {
    const source = [
      "来源：Unsplash photo-1686744838136-4627383403fb，已裁剪为方形 1080×1080 原始链接：",
      "https://images.unsplash.com/photo-1686744838136-4627383403fb?w=1080&h=1080&fit=crop&q=80"
    ].join("\n");
    const segments = resolveMediaLayout([
      text("t1", `已找到一张方形尺寸图 (1080×1080，1:1)：\n\n${source}`),
      img(image("a", { width: 1080, height: 1080 })),
      text("t2", "备用方形图："),
      img(image("b", { width: 1000, height: 1000 }))
    ]);
    const labels = segments
      .filter((segment) => segment.type === "side-flow")
      .map((segment) => (segment.type === "side-flow" ? { text: segment.text, id: segment.image.id } : null));
    expect(labels.some((item) => item?.text === "备用方形图：" && item.id === "a")).toBe(false);
    expect(labels.some((item) => item?.text === "备用方形图：" && item.id === "b")).toBe(true);
    expect(segments.some((segment) => segment.type === "text" && segment.text.includes("来源："))).toBe(true);
    const runs = groupMediaCardRuns(segments);
    expect(runs.map((run) => run.type)).toEqual(["item", "figure-row"]);
    expect(runs[1]?.type === "figure-row" ? runs[1].segments.map((segment) => segment.image.id) : []).toEqual([
      "a",
      "b"
    ]);
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

  it("does not column-pair a long wrapping fact list that would leave a hole under the image", () => {
    const facts = [
      "What's in it:",
      "- Pelican — white body, curving S-curve neck, long orange beak with a yellow throat pouch, a small head tuft, and a red scarf trailing in the wind",
      "- Bicycle — red diamond frame with chainstay, seatstay, seat tube, top tube, down tube, and fork; chainring, dashed chain, crank arms with two pedals",
      "- Contact points — the pelican's webbed feet sit on the pedals and its wing reaches forward to the handlebar",
      "- Scene — gradient sky, sun with rays, clouds, a road with a yellow dashed center line, grass tufts, and white speed lines",
      "- Animation — both wheels spin continuously via SMIL (animateTransform rotate, 1.6s loop)",
      "You can open it in a browser to see the wheels turn; static viewers like image previews will just show the first frame.",
      "One limit: I can't inspect pixels, so I verified the file only as valid XML."
    ].join("\n");
    const segments = resolveMediaLayout([
      text("t1", `SVG written and validated as well-formed XML: pelican-bicycle.svg (8.4 KB).\n\n${facts}`),
      img(image("a", { width: 800, height: 800 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "side-flow"]);
    expect(segments[1]).toEqual(expect.objectContaining({
      type: "side-flow",
      order: "image-text",
      wrap: false,
      columnPair: false,
      text: facts
    }));
  });

  it("stacks a compact list in a narrow column instead of crushing the text", () => {
    const info = [
      "具体信息：",
      "- 作者：Alexis B",
      "- 地点：Nancy, Grand Est, France",
      "- 描述：Black and white photograph of people walking with umbrellas on a rainy street in Nancy, France.",
      "- 尺寸：2072x2072，正方形，2024年11月5日发布",
      "- 链接：https://www.pexels.com/photo/example/"
    ].join("\n");
    const segments = resolveMediaLayout(
      [
        text("t1", `你链接的这张是 Pexels 上的一张黑白街拍：法国南希雨天的街景。\n\n${info}`),
        img(image("a", { width: 2072, height: 2072 }))
      ],
      { containerWidth: 360 }
    );
    expect(segments.map((segment) => segment.type)).toEqual(["text", "side-flow"]);
    expect(segments[1]).toEqual(expect.objectContaining({
      type: "side-flow",
      order: "image-text",
      wrap: false,
      columnPair: false,
      text: info
    }));
  });

  it("stacks a long body in a narrow column instead of wrapping", () => {
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
    const segments = resolveMediaLayout(
      [
        text("t1", body),
        img(image("a", { width: 1080, height: 1920 }))
      ],
      { containerWidth: SIDE_FLOW_MIN_WIDTH - 1 }
    );
    expect(segments.map((segment) => segment.type)).toEqual(["text", "single"]);
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
    const runs = groupMediaCardRuns(segments);
    expect(runs.map((run) => run.type)).toEqual(["cards"]);
    expect(cardsSlotRatio(runs[0])).toBeCloseTo(Math.sqrt((2 / 3) * (16 / 9)), 2);
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

  it("frames a soft banner to the slot with the least leftover bars", () => {
    const segments = resolveMediaLayout([
      text("t1", "图片："),
      img(image("wide", { width: 600, height: 200 })),
      text("t2", "图片带链接："),
      img(image("thumb", { width: 120, height: 60 }))
    ]);
    const runs = groupMediaCardRuns(segments);
    expect(runs.map((run) => run.type)).toEqual(["cards"]);
    expect(cardsSlotRatio(runs[0])).toBeCloseTo(Math.sqrt(6), 2);
  });

  it("does not pack consecutive ultra-wide images into a coordinating grid", () => {
    const segments = resolveMediaLayout([
      img(image("a", { width: 3840, height: 1080 })),
      img(image("b", { width: 3200, height: 900 }))
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["single", "single"]);
    expect(groupMediaCardRuns(segments).map((run) => run.type)).toEqual(["item", "item"]);
  });

  it("keeps sandwiched source copy as full-width text instead of a side column", () => {
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
    expect(segments.map((segment) => segment.type)).toEqual(["side-flow", "text", "side-flow"]);
    expect(segments[0]).toEqual(expect.objectContaining({
      type: "side-flow",
      columnPair: false,
      text: "已找到一张竖长图 (1080×1920, 9:16)：",
      image: expect.objectContaining({ id: "a" })
    }));
    expect(segments[1]).toEqual(expect.objectContaining({
      type: "text",
      text: source
    }));
    expect(segments[2]).toEqual(expect.objectContaining({
      type: "side-flow",
      text: "备用竖长图：",
      image: expect.objectContaining({ id: "b" })
    }));
    const runs = groupMediaCardRuns(segments);
    expect(runs.map((run) => run.type)).toEqual(["figure-row", "item", "figure-row"]);
    expect(runs.some((run) => run.type === "figure-row" && run.segments.length > 1)).toBe(false);
  });

  it("keeps a 1:2 backup portrait on the same figure path as 9:16", () => {
    const source = [
      "来源：Unsplash photo-1441974231531-c6227db76b6e，已裁剪为竖长幅 1080×1920 原始链接：",
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1080&h=1920&fit=crop&q=80"
    ].join("\n");
    const segments = resolveMediaLayout([
      text("t1", "已找到一张竖长图 (1080×1920, 9:16)："),
      img(image("a", { width: 1080, height: 1920 })),
      text("t2", `${source}\n\n备用竖长图：`),
      img(image("b", { width: 800, height: 1600 }))
    ]);
    const runs = groupMediaCardRuns(segments);
    expect(
      runs.flatMap((run) => (run.type === "figure-row" ? run.segments.map((segment) => segment.image.id) : []))
    ).toEqual(["a", "b"]);
    expect(runs.some((run) => (
      run.type === "item" && run.segment.type !== "text"
    ))).toBe(false);
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
    const runs = groupMediaCardRuns(segments);
    expect(runs.map((run) => run.type)).toEqual(["item", "cards", "item"]);
    expect(cardsSlotRatio(runs[1])).toBeCloseTo(Math.sqrt((600 / 900) * (1920 / 1080)), 2);
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

describe("sharedSlotRatio", () => {
  it("picks the ratio that cuts leftover bars, not 4:3 or the tallest image", () => {
    const pair = sharedSlotRatio([
      image("wide", { width: 600, height: 200 }),
      image("thumb", { width: 120, height: 60 })
    ]);
    expect(pair).not.toBeNull();
    const pairRatio = (pair?.width ?? 0) / (pair?.height ?? 1);
    expect(pairRatio).toBeCloseTo(Math.sqrt(6), 2);
    expect(letterboxWaste(3, pairRatio)).toBeLessThan(letterboxWaste(3, 2));
    expect(letterboxWaste(2, pairRatio)).toBeLessThan(letterboxWaste(2, 3));

    const mixed = sharedSlotRatio([
      image("a", { width: 200, height: 200 }),
      image("b", { width: 400, height: 300 }),
      image("c", { width: 600, height: 900 }),
      image("d", { width: 3840, height: 1080 })
    ]);
    expect(mixed).not.toBeNull();
    const mixedRatio = (mixed?.width ?? 0) / (mixed?.height ?? 1);
    expect(mixedRatio).toBeCloseTo(Math.sqrt((600 / 900) * (3840 / 1080)), 2);
    expect(letterboxWaste(3840 / 1080, mixedRatio)).toBeLessThan(letterboxWaste(3840 / 1080, 600 / 900));
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

  it("extracts a workspace-relative markdown image dest", () => {
    const tokens = scanMarkdownMediaTokens(
      "What's in it:\n\n![Pelican riding a bicycle](pelican-bicycle.svg)\n"
    );
    expect(tokens.filter((token) => token.type === "image")).toHaveLength(1);
    const image = tokens.find((token) => token.type === "image");
    expect(image?.type === "image" ? image.image.src : null).toBe("pelican-bicycle.svg");
    expect(image?.type === "image" ? image.image.attachment?.mediaType : null).toBe("image/svg+xml");
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

  it("peels a labeled linked image into caption text plus an image token", () => {
    const tokens = scanMarkdownMediaTokens(
      "图片带链接：[![小图片](https://picsum.photos/120/60)](https://example.com)\n"
    );
    expect(tokens.map((token) => token.type)).toEqual(["text", "image"]);
    expect(tokens[0]).toEqual(expect.objectContaining({ text: "图片带链接：" }));
    expect(tokens[1]?.type === "image" ? tokens[1].image.src : null).toBe(
      "https://picsum.photos/120/60"
    );
  });

  it("lays out a 3:1 photo and a 2:1 linked thumb as a captioned pair", () => {
    const tokens = scanMarkdownMediaTokens(
      [
        "图片：",
        "![占位图片](https://picsum.photos/600/200)",
        "",
        "图片带链接：[![小图片](https://picsum.photos/120/60)](https://example.com)"
      ].join("\n")
    );
    const sized = applyImageSizes(tokens, {
      "md-img:https://picsum.photos/600/200#1": { width: 600, height: 200 },
      "md-img:https://picsum.photos/120/60#1": { width: 120, height: 60 }
    });
    const segments = resolveMediaLayout(sized);
    expect(segments.map((segment) => segment.type)).toEqual(["side-flow", "side-flow"]);
    const runs = groupMediaCardRuns(segments);
    expect(runs.map((run) => run.type)).toEqual(["cards"]);
    expect(cardsSlotRatio(runs[0])).toBeCloseTo(Math.sqrt(6), 2);
  });

  it("extracts a standalone linked image without keeping the wrapper URL", () => {
    const tokens = scanMarkdownMediaTokens(
      "[![small](https://example.com/a.png)](https://example.com/page)\n"
    );
    expect(tokens.filter((token) => token.type === "image")).toHaveLength(1);
    expect(tokens[0]?.type === "image" ? tokens[0].image.src : null).toBe(
      "https://example.com/a.png"
    );
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
