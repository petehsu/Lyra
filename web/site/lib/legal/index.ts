import { PRIVACY_DOCUMENT } from "./privacy";
import { TERMS_DOCUMENT } from "./terms";
import type {
  LegalDocument,
  LegalLocale,
  LocalizedText
} from "./types";

export {
  DATA_PRACTICES,
  PRIVACY_DOCUMENT
} from "./privacy";
export {
  LEGAL_HISTORY,
  LEGAL_META,
  LEGAL_RELEASE_GATES,
  STATUS_LABEL
} from "./meta";
export { PROVIDER_RECORDS } from "./providers";
export { TERMS_DOCUMENT } from "./terms";
export { LEGAL_LOCALES } from "./types";
export type * from "./types";

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  TERMS_DOCUMENT,
  PRIVACY_DOCUMENT
] as const;

export const localized = (
  value: LocalizedText,
  locale: LegalLocale
): string => value[locale];

export const resolveLegalLocale = (
  value: string | readonly string[] | undefined
): LegalLocale => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "zh-CN" || candidate === "zh"
    ? "zh-CN"
    : "en-US";
};

export const legalHref = (
  path: string,
  locale: LegalLocale
): string => `${path}?lang=${encodeURIComponent(locale)}`;

export const LEGAL_NAVIGATION = [
  {
    path: "/legal",
    label: {
      "en-US": "Overview",
      "zh-CN": "总览"
    }
  },
  {
    path: "/legal/terms",
    label: {
      "en-US": "Terms",
      "zh-CN": "用户协议"
    }
  },
  {
    path: "/legal/privacy",
    label: {
      "en-US": "Privacy",
      "zh-CN": "隐私政策"
    }
  },
  {
    path: "/legal/providers",
    label: {
      "en-US": "Providers",
      "zh-CN": "服务商"
    }
  },
  {
    path: "/legal/licenses",
    label: {
      "en-US": "Licenses",
      "zh-CN": "第三方许可"
    }
  },
  {
    path: "/legal/history",
    label: {
      "en-US": "History",
      "zh-CN": "版本历史"
    }
  }
] as const;
