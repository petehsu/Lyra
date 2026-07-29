import { LegalShell } from "@/components/legal/legal-shell";
import {
  LEGAL_HISTORY,
  LEGAL_RELEASE_GATES,
  localized,
  type LegalLocale
} from "@/lib/legal";

const copy = {
  title: {
    "en-US": "Legal history",
    "zh-CN": "法律版本历史"
  },
  description: {
    "en-US":
      "Version, status, dates, retired drafts, and the release-gate record for the current terms and privacy policy.",
    "zh-CN":
      "记录版本、状态、日期、废止草案，以及当前用户协议和隐私政策的发布门禁。"
  },
  versionHistory: {
    "en-US": "Version history",
    "zh-CN": "版本记录"
  },
  noDate: {
    "en-US": "No effective date",
    "zh-CN": "无生效日期"
  },
  gates: {
    "en-US": "Current release-gate record",
    "zh-CN": "当前发布门禁记录"
  },
  gateIntro: {
    "en-US":
      "legal:release-check refuses publication while any item below is pending. Completed items remain recorded here.",
    "zh-CN":
      "以下任一项目处于待完成状态时，legal:release-check 会拒绝发布；已完成项目继续在此留档。"
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

export function HistoryPage({ locale }: { readonly locale: LegalLocale }) {
  return (
    <LegalShell
      locale={locale}
      currentPath="/legal/history"
      title={localized(copy.title, locale)}
      description={localized(copy.description, locale)}
    >
      <section
        className="legal-overview-section"
        aria-labelledby="version-history-title"
      >
        <h2 id="version-history-title">
          {localized(copy.versionHistory, locale)}
        </h2>
        <ol className="legal-history-list">
          {LEGAL_HISTORY.map((record) => (
            <li key={record.version}>
              <div className="legal-history-meta">
                <span>{record.version}</span>
                <span data-history-status={record.status}>
                  {record.status}
                </span>
                <time dateTime={record.date ?? undefined}>
                  {record.date ?? localized(copy.noDate, locale)}
                </time>
              </div>
              <h3>{localized(record.title, locale)}</h3>
              <p>{localized(record.summary, locale)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="legal-overview-section"
        aria-labelledby="history-gates-title"
      >
        <h2 id="history-gates-title">
          {localized(copy.gates, locale)}
        </h2>
        <p>{localized(copy.gateIntro, locale)}</p>
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
