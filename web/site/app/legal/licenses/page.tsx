import type { Metadata } from "next";
import { LegalShell } from "@/components/legal/legal-shell";
import { localized } from "@/lib/legal";
import {
  groupThirdPartyNotices,
  httpSourceUrl,
  loadThirdPartyNotices
} from "@/lib/legal/notices";
import {
  localeFromPageProps,
  type LegalPageProps
} from "@/lib/legal/page";

export const metadata: Metadata = {
  title: "Third-party Notices",
  alternates: {
    canonical: "/legal/licenses",
    languages: {
      en: "/legal/licenses?lang=en-US",
      "zh-CN": "/legal/licenses?lang=zh-CN"
    }
  }
};

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
    "en-US": "Distinct notice texts",
    "zh-CN": "不同声明文本"
  },
  sourceTitle: {
    "en-US": "Canonical generation",
    "zh-CN": "规范生成方式"
  },
  sourceBody: {
    "en-US":
      "This page reads the repository’s generated third-party notice JSON at build or server time. Repeated identical license texts are grouped, while every package name, version, ecosystem, source, and full captured text remains represented.",
    "zh-CN":
      "本页在构建或服务端渲染时读取仓库生成的第三方声明 JSON。相同许可文本会合并分组，但每个包的名称、版本、生态、来源和完整已捕获文本均保留。"
  },
  packageList: {
    "en-US": "Covered packages",
    "zh-CN": "覆盖的包"
  },
  source: {
    "en-US": "Source",
    "zh-CN": "来源"
  },
  noticeText: {
    "en-US": "License / notice text",
    "zh-CN": "许可 / 声明文本"
  },
  openGroup: {
    "en-US": "notice group",
    "zh-CN": "声明组"
  }
} as const;

export default async function LicensesPage(props: LegalPageProps) {
  const locale = await localeFromPageProps(props);
  const notices = loadThirdPartyNotices();
  const groups = groupThirdPartyNotices(notices);

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
        </div>
      </section>

      <div className="legal-license-groups">
        {groups.map((group, index) => (
          <details key={group.id} id={group.id} open>
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
                    const source =
                      item.source ?? item.repository ?? item.homepage;
                    const sourceUrl = httpSourceUrl(source);
                    return (
                      <li
                        key={`${item.ecosystem}:${item.name}:${item.version}`}
                      >
                        <code>
                          {item.name}@{item.version}
                        </code>
                        <span>{item.ecosystem}</span>
                        {sourceUrl ? (
                          <a href={sourceUrl} rel="external">
                            {localized(copy.source, locale)}
                          </a>
                        ) : source ? (
                          <code title={localized(copy.source, locale)}>
                            {source}
                          </code>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
              <section>
                <h2>{localized(copy.noticeText, locale)}</h2>
                <pre>{group.licenseText}</pre>
              </section>
            </div>
          </details>
        ))}
      </div>
    </LegalShell>
  );
}
