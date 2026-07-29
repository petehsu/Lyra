import type { MetadataRoute } from "next";
import { LEGAL_META } from "@/lib/legal";

export default function sitemap(): MetadataRoute.Sitemap {
  const publicPages: MetadataRoute.Sitemap = [
    {
      url: "https://lyra.ltd/zh",
      changeFrequency: "weekly",
      priority: 1
    },
    {
      url: "https://lyra.ltd/en",
      changeFrequency: "weekly",
      priority: 1
    }
  ];
  const legalPages: MetadataRoute.Sitemap = [
    "/legal",
    "/legal/terms",
    "/legal/privacy",
    "/legal/licenses",
    "/legal/providers",
    "/legal/history"
  ].flatMap((path) =>
    ["en-US", "zh-CN"].map((locale) => ({
      url: `https://lyra.ltd${path}/${locale}`,
      changeFrequency: "monthly" as const,
      priority: path === "/legal" || path === "/legal/history" ? 0.4 : 0.5
    }))
  );
  return LEGAL_META.status === "effective"
    ? [...publicPages, ...legalPages]
    : publicPages;
}
