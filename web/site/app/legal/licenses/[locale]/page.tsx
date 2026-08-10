import type { Metadata } from "next";
import { notFound } from "next/navigation";
import licenseIndex from "../../../../../../legal/generated/third-party-license-index.json";
import { LegalShell } from "@/components/legal/legal-shell";
import {
  localized,
  type LegalLocale
} from "@/lib/legal";

type LicenseIndex = {
  readonly generatedAt: string;
  readonly packageCount: number;
  readonly groups: readonly {
    readonly license: string;
    readonly items: readonly {
      readonly name: string;
      readonly version?: string;
      readonly ecosystem: string;
    }[];
  }[];
};

const notices = licenseIndex as LicenseIndex;

type LicensesPageProps = {
  readonly params: Promise<{
    readonly locale: string;
  }>;
};

const localeFromParams = async (
  props: LicensesPageProps
): Promise<LegalLocale> => {
  const { locale } = await props.params;
  if (locale !== "en-US" && locale !== "zh-CN") {
    notFound();
  }
  return locale;
};

export function generateStaticParams() {
  return [{ locale: "en-US" }, { locale: "zh-CN" }];
}

export const dynamicParams = false;

export async function generateMetadata(
  props: LicensesPageProps
): Promise<Metadata> {
  const locale = await localeFromParams(props);
  return {
    title:
      locale === "zh-CN"
        ? "第三方声明"
        : "Third-party Notices",
    alternates: {
      canonical: `/legal/licenses/${locale}`,
      languages: {
        en: "/legal/licenses/en-US",
        "zh-CN": "/legal/licenses/zh-CN"
      }
    }
  };
}

const copy = {
  title: {
    "en-US": "Third-party notices",
    "zh-CN": "第三方声明"
  },
  description: {
    "en-US":
      "License and attribution text generated directly from Lyra’s canonical dependency inventory—without a separately maintained website copy.",
    "zh-CN":
      "直接由 Lyra 规范依赖清单生成的许可与归属文本，不再维护独立的网站副本。"
  },
  generated: {
    "en-US": "Inventory generated",
    "zh-CN": "清单生成时间"
  },
  packages: {
    "en-US": "Packages and components",
    "zh-CN": "包与组件"
  },
  groups: {
    "en-US": "Recorded license expressions",
    "zh-CN": "记录的许可表达式"
  },
  sourceTitle: {
    "en-US": "Canonical generation",
    "zh-CN": "规范生成方式"
  },
  sourceBody: {
    "en-US":
      "This index is generated from the repository’s canonical third-party inventory and groups components by their recorded license expression. Every source, attribution, notice, and full captured license text remains available in the complete plain-text notice file.",
    "zh-CN":
      "本索引由仓库的规范第三方清单生成，并按记录的许可表达式对组件分组。每个来源、归属信息、声明及完整已捕获许可文本均保留在完整纯文本声明文件中。"
  },
  fullNotices: {
    "en-US": "Read or download the complete notices",
    "zh-CN": "阅读或下载完整声明"
  },
  fullNoticesDetail: {
    "en-US":
      "Plain text · generated from the same canonical inventory · approximately 6.3 MiB",
    "zh-CN":
      "纯文本 · 与本页使用同一规范清单生成 · 约 6.3 MiB"
  },
  sourceOffer: {
    "en-US": "macOS x64 corresponding source and relinking material",
    "zh-CN": "macOS x64 对应源码与重新链接材料"
  },
  sourceOfferDetail: {
    "en-US":
      "Lyra 0.1.0-preview.4 · aria2, GMP and libiconv source · exact conda package evidence",
    "zh-CN":
      "Lyra 0.1.0-preview.4 · aria2、GMP 与 libiconv 源码 · 精确 conda 包证据"
  },
  packageList: {
    "en-US": "Covered packages",
    "zh-CN": "覆盖的包"
  },
  openGroup: {
    "en-US": "packages",
    "zh-CN": "个包"
  }
} as const;

export default async function LicensesPage(props: LicensesPageProps) {
  const locale = await localeFromParams(props);
  const groups = notices.groups;

  return (
    <LegalShell
      locale={locale}
      currentPath="/legal/licenses"
      title={localized(copy.title, locale)}
      description={localized(copy.description, locale)}
    >
      <section className="legal-license-summary">
        <dl>
          <div>
            <dt>{localized(copy.generated, locale)}</dt>
            <dd>
              <time dateTime={notices.generatedAt}>
                {notices.generatedAt}
              </time>
            </dd>
          </div>
          <div>
            <dt>{localized(copy.packages, locale)}</dt>
            <dd>{notices.packageCount.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>{localized(copy.groups, locale)}</dt>
            <dd>{groups.length.toLocaleString("en-US")}</dd>
          </div>
        </dl>
        <div>
          <h2>{localized(copy.sourceTitle, locale)}</h2>
          <p>{localized(copy.sourceBody, locale)}</p>
          <a
            className="legal-license-download"
            href="/legal/third-party-notices.txt"
          >
            <strong>{localized(copy.fullNotices, locale)}</strong>
            <span>{localized(copy.fullNoticesDetail, locale)}</span>
          </a>
          <a
            className="legal-license-download"
            href="https://github.com/petehsu/lyra-releases/releases/download/v0.1.0-preview.4/SOURCE-OFFER-0.1.0-preview.4-darwin-x64.md"
          >
            <strong>{localized(copy.sourceOffer, locale)}</strong>
            <span>{localized(copy.sourceOfferDetail, locale)}</span>
          </a>
        </div>
      </section>

      <div className="legal-license-groups">
        {groups.map((group, index) => (
          <details
            key={group.license}
            id={`license-expression-${String(index + 1).padStart(3, "0")}`}
            open
          >
            <summary>
              <span aria-hidden="true">
                {String(index + 1).padStart(4, "0")}
              </span>
              <strong>{group.license}</strong>
              <span>
                {group.items.length.toLocaleString("en-US")}{" "}
                {localized(copy.openGroup, locale)}
              </span>
            </summary>
            <div className="legal-license-group-content">
              <section>
                <h2>{localized(copy.packageList, locale)}</h2>
                <ul className="legal-package-list">
                  {group.items.map((item) => {
                    return (
                      <li
                        key={`${item.ecosystem}:${item.name}:${item.version}`}
                      >
                        <code>
                          {item.name}{item.version ? `@${item.version}` : ""}
                        </code>
                        <span>{item.ecosystem}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </details>
        ))}
      </div>
    </LegalShell>
  );
}
