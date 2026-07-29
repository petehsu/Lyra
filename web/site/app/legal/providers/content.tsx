import { LegalShell } from "@/components/legal/legal-shell";
import {
  PROVIDER_RECORDS,
  localized,
  type LegalLocale
} from "@/lib/legal";

const copy = {
  title: {
    "en-US": "Provider register",
    "zh-CN": "服务商登记表"
  },
  description: {
    "en-US":
      "A maintained inventory of network destinations, data categories, processing regions, privacy links, retention/training statements, and DPA status.",
    "zh-CN":
      "持续维护网络目的地、数据类别、处理地区、隐私链接、保留/训练说明及 DPA 状态。"
  },
  warningTitle: {
    "en-US": "Pending fields are release blockers",
    "zh-CN": "待核验字段属于发布阻断项"
  },
  warningBody: {
    "en-US":
      "An entry in this register does not mean Lyra has completed vendor due diligence or entered a DPA. Provider-controlled facts can change. Re-check the exact endpoint configured in Lyra before sending data.",
    "zh-CN":
      "服务商出现在本表中不表示 Lyra 已完成供应商尽调或签署 DPA。由服务商控制的事实可能变化；发送数据前请核对 Lyra 中实际配置的端点。"
  },
  nominatim: {
    "en-US":
      "Exact-coordinate reverse geocoding uses the public Nominatim endpoint. Its usage policy says not to submit personal or confidential data, so this implementation requires explicit release review.",
    "zh-CN":
      "精确坐标逆地理编码使用公共 Nominatim 端点。其使用政策要求不要提交个人或机密数据，因此该实现必须接受明确发布审阅。"
  },
  policyLink: {
    "en-US": "Read the Nominatim usage policy",
    "zh-CN": "查看 Nominatim 使用政策"
  },
  caption: {
    "en-US": "Current Lyra provider and destination register",
    "zh-CN": "当前 Lyra 服务商与目的地登记表"
  },
  provider: {
    "en-US": "Provider / destination",
    "zh-CN": "服务商 / 目的地"
  },
  service: {
    "en-US": "Service and data",
    "zh-CN": "服务与数据"
  },
  region: {
    "en-US": "Region",
    "zh-CN": "地区"
  },
  privacy: {
    "en-US": "Privacy link",
    "zh-CN": "隐私链接"
  },
  retention: {
    "en-US": "Training / retention",
    "zh-CN": "训练 / 保留"
  },
  dpa: {
    "en-US": "DPA status",
    "zh-CN": "DPA 状态"
  },
  status: {
    "en-US": "Review",
    "zh-CN": "审阅"
  },
  pending: {
    "en-US": "Pending verification",
    "zh-CN": "待核验"
  },
  userConfigured: {
    "en-US": "User configured",
    "zh-CN": "用户配置"
  },
  verified: {
    "en-US": "Verified",
    "zh-CN": "已核验"
  },
  policy: {
    "en-US": "Policy",
    "zh-CN": "政策"
  },
  missingPolicy: {
    "en-US": "Not yet verified",
    "zh-CN": "尚未核验"
  }
} as const;

export function ProvidersPage({ locale }: { readonly locale: LegalLocale }) {
  const reviewLabels = {
    verified: localized(copy.verified, locale),
    pending: localized(copy.pending, locale),
    "user-configured": localized(copy.userConfigured, locale)
  } as const;

  return (
    <LegalShell
      locale={locale}
      currentPath="/legal/providers"
      title={localized(copy.title, locale)}
      description={localized(copy.description, locale)}
    >
      <section className="legal-overview-notice">
        <h2>{localized(copy.warningTitle, locale)}</h2>
        <p>{localized(copy.warningBody, locale)}</p>
        <p>
          {localized(copy.nominatim, locale)}{" "}
          <a href="https://operations.osmfoundation.org/policies/nominatim/">
            {localized(copy.policyLink, locale)}
          </a>
          .
        </p>
      </section>

      <section
        className="legal-wide-section"
        aria-labelledby="provider-register-title"
      >
        <h2 id="provider-register-title" className="legal-visually-hidden">
          {localized(copy.title, locale)}
        </h2>
        <div className="legal-table-scroll" tabIndex={0}>
          <table className="legal-data-table legal-provider-table">
            <caption>{localized(copy.caption, locale)}</caption>
            <thead>
              <tr>
                <th scope="col">{localized(copy.provider, locale)}</th>
                <th scope="col">{localized(copy.service, locale)}</th>
                <th scope="col">{localized(copy.region, locale)}</th>
                <th scope="col">{localized(copy.privacy, locale)}</th>
                <th scope="col">{localized(copy.retention, locale)}</th>
                <th scope="col">{localized(copy.dpa, locale)}</th>
                <th scope="col">{localized(copy.status, locale)}</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDER_RECORDS.map((record) => (
                <tr key={record.id} id={`provider-${record.id}`}>
                  <th scope="row">{record.provider}</th>
                  <td data-label={localized(copy.service, locale)}>
                    <strong>{localized(record.service, locale)}</strong>
                    <span>{localized(record.data, locale)}</span>
                  </td>
                  <td data-label={localized(copy.region, locale)}>
                    {localized(record.region, locale)}
                  </td>
                  <td data-label={localized(copy.privacy, locale)}>
                    {record.privacyUrl ? (
                      <a href={record.privacyUrl} rel="external">
                        {localized(copy.policy, locale)}
                      </a>
                    ) : (
                      localized(copy.missingPolicy, locale)
                    )}
                  </td>
                  <td data-label={localized(copy.retention, locale)}>
                    {localized(record.trainingAndRetention, locale)}
                  </td>
                  <td data-label={localized(copy.dpa, locale)}>
                    {localized(record.dpaStatus, locale)}
                  </td>
                  <td data-label={localized(copy.status, locale)}>
                    <span
                      className="legal-review-state"
                      data-review={record.reviewStatus}
                    >
                      {reviewLabels[record.reviewStatus]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </LegalShell>
  );
}
