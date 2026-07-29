import { LegalShell } from "@/components/legal/legal-shell";
import {
  LEGAL_META,
  LEGAL_RELEASE_GATES,
  legalHref,
  localized,
  type LegalLocale
} from "@/lib/legal";

const copy = {
  title: {
    "en-US": "Legal and trust center",
    "zh-CN": "法律与信任中心"
  },
  description: {
    "en-US": LEGAL_META.status === "pending"
      ? "One bilingual source for Lyra’s pending terms, privacy disclosures, provider register, open-source notices, and publication history."
      : "One bilingual source for Lyra’s effective terms, privacy disclosures, provider register, open-source notices, and publication history.",
    "zh-CN": LEGAL_META.status === "pending"
      ? "Lyra 待发布用户协议、隐私披露、服务商登记、开源声明和发布历史的统一双语真源。"
      : "Lyra 已生效用户协议、隐私披露、服务商登记、开源声明和发布历史的统一双语真源。"
  },
  publicationTitle: {
    "en-US": LEGAL_META.status === "pending"
      ? "Publication is intentionally blocked"
      : "Current legal version is effective",
    "zh-CN": LEGAL_META.status === "pending"
      ? "当前有意阻止正式发布"
      : "当前法律版本已生效"
  },
  publicationBody: {
    "en-US": LEGAL_META.status === "pending"
      ? "These pages describe the implemented beta, but they are not an effective agreement or policy. A personal contact mailbox is published, while the effective date, legal service address, verified response workflow, and the remaining gates below are still incomplete."
      : `Version ${LEGAL_META.version} took effect on ${LEGAL_META.effectiveDate}. Legal History records this publication and any later replacement.`,
    "zh-CN": LEGAL_META.status === "pending"
      ? "这些页面描述当前已实现的测试版，但尚不构成生效协议或政策。目前已公布个人联系邮箱，生效日期、法律送达地址、经核验的响应流程及以下其余门禁仍未完成。"
      : `版本 ${LEGAL_META.version} 已于 ${LEGAL_META.effectiveDate} 生效；本次发布及后续替代版本记录于法律版本历史。`
  },
  pages: {
    "en-US": "Documents",
    "zh-CN": "文档"
  },
  gates: {
    "en-US": "Release gates",
    "zh-CN": "发布门禁"
  },
  gateState: {
    pending: {
      "en-US": "Pending",
      "zh-CN": "待完成"
    },
    complete: {
      "en-US": "Complete",
      "zh-CN": "已完成"
    }
  }
} as const;

const cards = [
  {
    path: "/legal/terms",
    title: {
      "en-US": "Terms of Use",
      "zh-CN": "用户协议"
    },
    body: {
      "en-US":
        "Free-beta license, Agent risk, third parties, acceptable use, liability, and dispute rules.",
      "zh-CN":
        "免费测试版许可、Agent 风险、第三方、可接受使用、责任和争议规则。"
    }
  },
  {
    path: "/legal/privacy",
    title: {
      "en-US": "Privacy Policy",
      "zh-CN": "隐私政策"
    },
    body: {
      "en-US":
        "Feature-by-feature data inventory, model boundary, local storage, credentials, identity inference, and choices.",
      "zh-CN":
        "按功能划分的数据清单、模型边界、本机存储、凭证、身份推导和用户选择。"
    }
  },
  {
    path: "/legal/providers",
    title: {
      "en-US": "Provider Register",
      "zh-CN": "服务商登记表"
    },
    body: {
      "en-US":
        "Destinations, data categories, regions, policies, retention/training statements, and DPA status.",
      "zh-CN":
        "目的地、数据类别、地区、政策、保留/训练说明和 DPA 状态。"
    }
  },
  {
    path: "/legal/licenses",
    title: {
      "en-US": "Third-party Notices",
      "zh-CN": "第三方声明"
    },
    body: {
      "en-US":
        "Generated at build time from the repository’s canonical dependency and license inventory.",
      "zh-CN":
        "构建时直接由仓库规范依赖与许可证清单生成。"
    }
  },
  {
    path: "/legal/history",
    title: {
      "en-US": "Legal History",
      "zh-CN": "法律版本历史"
    },
    body: {
      "en-US":
        "Version status, dates, changes, retired drafts, and release-gate record.",
      "zh-CN":
        "版本状态、日期、变更、废止草案及发布门禁记录。"
    }
  }
] as const;

export function LegalOverviewPage({
  locale
}: {
  readonly locale: LegalLocale;
}) {
  return (
    <LegalShell
      locale={locale}
      currentPath="/legal"
      title={localized(copy.title, locale)}
      description={localized(copy.description, locale)}
    >
      <section className="legal-overview-notice">
        <p className="legal-eyebrow">
          {LEGAL_META.version} · {LEGAL_META.status}
        </p>
        <h2>{localized(copy.publicationTitle, locale)}</h2>
        <p>{localized(copy.publicationBody, locale)}</p>
      </section>

      <section
        className="legal-overview-section"
        aria-labelledby="legal-pages-title"
      >
        <h2 id="legal-pages-title">
          {localized(copy.pages, locale)}
        </h2>
        <div className="legal-card-grid">
          {cards.map((card) => (
            <a
              className="legal-card"
              href={legalHref(card.path, locale)}
              key={card.path}
            >
              <h3>{localized(card.title, locale)}</h3>
              <p>{localized(card.body, locale)}</p>
              <span aria-hidden="true">→</span>
            </a>
          ))}
        </div>
      </section>

      <section
        className="legal-overview-section"
        aria-labelledby="release-gates-title"
      >
        <h2 id="release-gates-title">
          {localized(copy.gates, locale)}
        </h2>
        <ol className="legal-gate-list">
          {LEGAL_RELEASE_GATES.map((gate) => (
            <li key={gate.id}>
              <div>
                <span className="legal-gate-state">
                  {localized(copy.gateState[gate.state], locale)}
                </span>
                <h3>{localized(gate.label, locale)}</h3>
              </div>
              <p>{localized(gate.detail, locale)}</p>
            </li>
          ))}
        </ol>
      </section>
    </LegalShell>
  );
}
