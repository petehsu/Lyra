import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://lyra.ltd/zh",
      changeFrequency: "weekly",
      priority: 1
    },
    {
      url: "https://lyra.ltd/en",
      changeFrequency: "weekly",
      priority: 1
    },
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
    }
  ];
}
