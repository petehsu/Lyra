import type { MetadataRoute } from "next";

import { source } from "@/lib/source";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages().map((page) => ({
    url: new URL(page.url, "https://docs.lyra.ltd").toString(),
    changeFrequency: "weekly" as const,
    priority: page.url.endsWith("/docs") ? 1 : 0.7
  }));

  return [
    {
      url: "https://docs.lyra.ltd/zh-CN",
      changeFrequency: "weekly",
      priority: 0.8
    },
    {
      url: "https://docs.lyra.ltd/en-US",
      changeFrequency: "weekly",
      priority: 0.8
    },
    ...pages
  ];
}
