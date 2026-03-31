import Link from "next/link";

import { resolveServerLocale } from "@/lib/runtime-context";

const copy = {
  "zh-CN": {
    title: "Lyra 文档",
    description:
      "面向 Lyra 工作台的官方文档站。内容覆盖架构、模块边界、设计规范与关键能力实现。",
    cta: "进入文档"
  },
  "en-US": {
    title: "Lyra Docs",
    description:
      "Official documentation for the Lyra workbench, covering architecture, boundaries, design standards, and core capabilities.",
    cta: "Open Docs"
  }
} as const;

export default async function HomePage() {
  const locale = await resolveServerLocale();
  const text = copy[locale];

  return (
    <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h1 className="mb-4 text-3xl font-semibold">{text.title}</h1>
      <p className="mb-6 max-w-2xl text-fd-muted-foreground">
        {text.description}
      </p>
      <Link
        href={`/docs?locale=${locale}`}
        className="rounded-full border border-fd-border px-4 py-2 text-sm transition-colors hover:border-fd-primary hover:text-fd-primary"
      >
        {text.cta}
      </Link>
    </section>
  );
}
