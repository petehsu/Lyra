import {
  LEGAL_META,
  localized,
  type LegalLocale,
  type LocalizedText
} from "@/lib/legal";

type LegalContactDetailsProps = {
  readonly locale: LegalLocale;
  readonly variant: "terms" | "privacy";
};

const copy = {
  terms: {
    title: {
      "en-US": "Contact and legal service details",
      "zh-CN": "联系与法律送达信息"
    },
    introduction: {
      "en-US":
        "Use the support channel for agreement and product questions, the privacy channel for personal-information matters, and the service address for formal legal notices.",
      "zh-CN":
        "协议及产品问题请使用支持渠道，个人信息事项请使用隐私渠道，正式法律通知请寄送至送达地址。"
    }
  },
  privacy: {
    title: {
      "en-US": "Privacy requests and assistance",
      "zh-CN": "隐私权利请求与协助"
    },
    introduction: {
      "en-US":
        "Use the privacy channel to exercise applicable privacy rights or ask about personal-information processing. Use the support channel for account or product assistance.",
      "zh-CN":
        "行使适用隐私权利或询问个人信息处理事项时，请使用隐私渠道；账户或产品协助请使用支持渠道。"
    }
  },
  privacyEmail: {
    "en-US": "Privacy email",
    "zh-CN": "隐私邮箱"
  },
  supportEmail: {
    "en-US": "Support email",
    "zh-CN": "支持邮箱"
  },
  serviceAddress: {
    "en-US": "Legal service address",
    "zh-CN": "法律送达地址"
  },
  emailPending: {
    "en-US":
      "Not yet verified — publication remains blocked.",
    "zh-CN": "尚未验证——当前仍禁止正式发布。"
  },
  addressPending: {
    "en-US":
      "Not yet provided or verified — publication remains blocked.",
    "zh-CN": "尚未填写或验证——当前仍禁止正式发布。"
  },
  personalNotice: {
    "en-US":
      "The mailbox and the alternative channels are personal contact methods maintained by Pete Hsu, not a staffed support or privacy desk. A message may be filtered, delayed, or unavailable on a particular platform. If you receive no response within a reasonable time, resend it or use another listed channel. Do not send passwords, API keys, or unnecessary sensitive information.",
    "zh-CN":
      "本邮箱及备用渠道均为徐远豪（Pete Hsu）本人维护的个人联系方式，并非专职客服或隐私事务团队。消息可能因过滤、延迟或平台限制而无法送达；如在合理时间内未收到回复，请重新发送或改用其他列明渠道。请勿发送密码、API 密钥或非必要敏感信息。"
  },
  alternativesLink: {
    "en-US": "View the four alternative personal channels",
    "zh-CN": "查看四个备用个人联系渠道"
  }
} satisfies Readonly<
  Record<string, LocalizedText | Readonly<Record<string, LocalizedText>>>
>;

function EmailContact({
  field,
  label,
  locale,
  value
}: {
  readonly field: "privacyEmail" | "supportEmail";
  readonly label: LocalizedText;
  readonly locale: LegalLocale;
  readonly value: string | null;
}) {
  return (
    <div data-contact-field={field}>
      <dt>{localized(label, locale)}</dt>
      <dd>
        {value === null ? (
          <span data-contact-state="pending">
            {localized(copy.emailPending, locale)}
          </span>
        ) : (
          <a
            data-contact-state="available"
            href={`mailto:${value}`}
          >
            {value}
          </a>
        )}
      </dd>
    </div>
  );
}

export function LegalContactDetails({
  locale,
  variant
}: LegalContactDetailsProps) {
  const panelCopy = copy[variant];
  const panelId = `${variant}-contact-details`;

  return (
    <section
      className="legal-contact-details"
      id={panelId}
      aria-labelledby={`${panelId}-title`}
    >
      <h2 id={`${panelId}-title`}>
        {localized(panelCopy.title, locale)}
      </h2>
      <p>{localized(panelCopy.introduction, locale)}</p>
      <p className="legal-contact-personal-note">
        {localized(copy.personalNotice, locale)}{" "}
        <a
          href={locale === "zh-CN" ? "/zh#contact" : "/en#contact"}
        >
          {localized(copy.alternativesLink, locale)}
        </a>
        {locale === "zh-CN" ? "。" : "."}
      </p>
      <dl>
        <EmailContact
          field="privacyEmail"
          label={copy.privacyEmail}
          locale={locale}
          value={LEGAL_META.contact.privacyEmail}
        />
        <EmailContact
          field="supportEmail"
          label={copy.supportEmail}
          locale={locale}
          value={LEGAL_META.contact.supportEmail}
        />
        {variant === "terms" ? (
          <div data-contact-field="serviceAddress">
            <dt>{localized(copy.serviceAddress, locale)}</dt>
            <dd>
              {LEGAL_META.contact.serviceAddress === null ? (
                <span data-contact-state="pending">
                  {localized(copy.addressPending, locale)}
                </span>
              ) : (
                <address data-contact-state="available">
                  {LEGAL_META.contact.serviceAddress}
                </address>
              )}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
