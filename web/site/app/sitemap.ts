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
    {
      url: "https://lyra.ltd/legal/",
      changeFrequency: "monthly",
      priority: 0.4
    },
    {
      url: "https://lyra.ltd/legal/terms",
      changeFrequency: "monthly",
      priority: 0.5
    },
    {
      url: "https://lyra.ltd/legal/privacy",
      changeFrequency: "monthly",
      priority: 0.5
    },
    {
      url: "https://lyra.ltd/legal/licenses",
      changeFrequency: "monthly",
      priority: 0.5
    },
    {
      url: "https://lyra.ltd/legal/providers",
      changeFrequency: "monthly",
      priority: 0.5
    },
    {
      url: "https://lyra.ltd/legal/history",
      changeFrequency: "monthly",
      priority: 0.4
    }
  ];
  return LEGAL_META.status === "effective"
    ? [...publicPages, ...legalPages]
    : publicPages;
}
