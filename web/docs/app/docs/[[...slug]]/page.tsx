import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createRelativeLink } from "fumadocs-ui/mdx";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle
} from "fumadocs-ui/layouts/docs/page";

import { getMDXComponents } from "@/components/mdx";
import { resolveServerLocale } from "@/lib/runtime-context";
import { source } from "@/lib/source";

type DocsPageProps = {
  readonly params: Promise<{
    readonly slug?: string[];
  }>;
};

export default async function Page({ params }: DocsPageProps) {
  const resolved = await params;
  const locale = await resolveServerLocale();
  const page = source.getPage(resolved.slug, locale);
  if (page === undefined) {
    notFound();
  }

  const MDX = page.data.body;
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page)
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateMetadata({
  params
}: DocsPageProps): Promise<Metadata> {
  const resolved = await params;
  const locale = await resolveServerLocale();
  const page = source.getPage(resolved.slug, locale);
  if (page === undefined) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description
  };
}
