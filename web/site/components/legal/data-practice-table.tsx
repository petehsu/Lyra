import {
  DATA_PRACTICES,
  localized,
  type LegalLocale
} from "@/lib/legal";

const labels = {
  title: {
    "en-US": "Current processing by feature",
    "zh-CN": "按功能划分的当前处理"
  },
  caption: {
    "en-US":
      "Data fields and source, purpose, legal basis, recipient and region, retention, and deletion for implemented Lyra features.",
    "zh-CN":
      "Lyra 已实现功能的数据字段与来源、目的、处理依据、接收方与地区、保留及删除方式。"
  },
  category: {
    "en-US": "Feature / data",
    "zh-CN": "功能 / 数据"
  },
  fields: {
    "en-US": "Fields and source",
    "zh-CN": "字段与来源"
  },
  purpose: {
    "en-US": "Purpose",
    "zh-CN": "目的"
  },
  legalBasis: {
    "en-US": "Legal basis / consent",
    "zh-CN": "处理依据 / 同意"
  },
  recipient: {
    "en-US": "Recipient and region",
    "zh-CN": "接收方与地区"
  },
  retention: {
    "en-US": "Retention",
    "zh-CN": "保留"
  },
  deletion: {
    "en-US": "Deletion",
    "zh-CN": "删除"
  }
} as const;

export function DataPracticeTable({
  locale
}: {
  readonly locale: LegalLocale;
}) {
  return (
    <section
      className="legal-section legal-wide-section"
      aria-labelledby="processing-table-title"
    >
      <h2 id="processing-table-title">
        {localized(labels.title, locale)}
      </h2>
      <div className="legal-table-scroll" tabIndex={0}>
        <table className="legal-data-table">
          <caption>{localized(labels.caption, locale)}</caption>
          <thead>
            <tr>
              <th scope="col">{localized(labels.category, locale)}</th>
              <th scope="col">{localized(labels.fields, locale)}</th>
              <th scope="col">{localized(labels.purpose, locale)}</th>
              <th scope="col">{localized(labels.legalBasis, locale)}</th>
              <th scope="col">{localized(labels.recipient, locale)}</th>
              <th scope="col">{localized(labels.retention, locale)}</th>
              <th scope="col">{localized(labels.deletion, locale)}</th>
            </tr>
          </thead>
          <tbody>
            {DATA_PRACTICES.map((practice) => (
              <tr key={practice.id} id={`practice-${practice.id}`}>
                <th scope="row">
                  {localized(practice.category, locale)}
                </th>
                <td data-label={localized(labels.fields, locale)}>
                  {localized(practice.fieldsAndSource, locale)}
                </td>
                <td data-label={localized(labels.purpose, locale)}>
                  {localized(practice.purpose, locale)}
                </td>
                <td data-label={localized(labels.legalBasis, locale)}>
                  {localized(practice.legalBasis, locale)}
                </td>
                <td data-label={localized(labels.recipient, locale)}>
                  {localized(practice.recipientAndRegion, locale)}
                </td>
                <td data-label={localized(labels.retention, locale)}>
                  {localized(practice.retention, locale)}
                </td>
                <td data-label={localized(labels.deletion, locale)}>
                  {localized(practice.deletion, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
