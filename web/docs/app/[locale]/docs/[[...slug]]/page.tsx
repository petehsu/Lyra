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
import { normalizeDocsLocale } from "@/lib/i18n";
import { source } from "@/lib/source";

type DocsPageProps = {
  readonly params: Promise<{
    readonly locale: string;
    readonly slug?: string[];
  }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return source.generateParams("slug", "locale");
}

export default async function Page({ params }: DocsPageProps) {
  const resolved = await params;
  const locale = normalizeDocsLocale(resolved.locale);
  if (locale === null) notFound();

  const page = source.getPage(resolved.slug, locale);
  if (page === undefined) notFound();

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

export async function generateMetadata({ params }: DocsPageProps): Promise<Metadata> {
  const resolved = await params;
  const locale = normalizeDocsLocale(resolved.locale);
  if (locale === null) notFound();

  const page = source.getPage(resolved.slug, locale);
  if (page === undefined) notFound();

  return {
    title: page.data.title,
    description: page.data.description
  };
}
