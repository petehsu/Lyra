import type {
  LegalHistoryRecord,
  LegalStatus,
  LocalizedText,
  ReleaseGate
} from "./types";
import { OPERATOR_PERSONAL_EMAIL } from "../contact";

type LegalMetadata = {
  readonly schemaVersion: number;
  readonly version: string;
  readonly status: Extract<LegalStatus, "pending" | "effective">;
  readonly effectiveDate: string | null;
  readonly lastVerified: string;
  readonly applicableVersion: string;
  readonly operator: {
    readonly legalName: string;
    readonly englishName: string;
    readonly tradingName: string;
    readonly form: string;
  };
  readonly equalAuthority: boolean;
  readonly contact: {
    readonly privacyEmail: string | null;
    readonly supportEmail: string | null;
    readonly serviceAddress: string | null;
  };
};

export const LEGAL_META: LegalMetadata = {
  schemaVersion: 1,
  version: "0.3.0-draft",
  status: "pending",
  effectiveDate: null,
  lastVerified: "2026-07-29",
  applicableVersion: "Lyra Desktop 0.1.x beta",
  operator: {
    legalName: "徐远豪",
    englishName: "Pete Hsu",
    tradingName: "Lyra",
    form: "Individual developer in mainland China"
  },
  equalAuthority: true,
  contact: {
    privacyEmail: OPERATOR_PERSONAL_EMAIL,
    supportEmail: OPERATOR_PERSONAL_EMAIL,
    serviceAddress: null
  }
};

const STATUS_LABELS = {
  pending: {
    "en-US": "Pending publication — not effective",
    "zh-CN": "待发布——尚未生效"
  },
  effective: {
    "en-US": "Effective",
    "zh-CN": "已生效"
  }
} satisfies Readonly<
  Record<LegalMetadata["status"], LocalizedText>
>;

export const STATUS_LABEL: LocalizedText =
  STATUS_LABELS[LEGAL_META.status];

export const LEGAL_HISTORY: readonly LegalHistoryRecord[] = [
  {
    version: LEGAL_META.version,
    status: LEGAL_META.status,
    date: LEGAL_META.effectiveDate,
    title: {
      "en-US": "Full legal and documentation rewrite",
      "zh-CN": "法律与文档体系完整重构"
    },
    summary:
      LEGAL_META.status === "pending"
        ? {
            "en-US":
              "Current bilingual draft aligned with the implemented beta. Publication is blocked until every release gate is complete.",
            "zh-CN":
              "与当前测试版实现对齐的中英文草案。所有发布门禁完成前不得发布生效。"
          }
        : {
            "en-US":
              "Effective bilingual terms and privacy disclosures aligned with the implemented beta.",
            "zh-CN":
              "与当前测试版实现对齐并已生效的中英文用户协议与隐私披露。"
          }
  },
  {
    version: "0.2.0-draft",
    status: "retired",
    date: "2026-07-14",
    title: {
      "en-US": "Legacy static-site draft",
      "zh-CN": "旧静态页面草案"
    },
    summary: {
      "en-US":
        "Retired because its product descriptions and data-flow statements no longer matched the implementation. It was not promoted by this release workflow as an effective version.",
      "zh-CN":
        "因产品描述和数据流陈述已与实现不符而废止。本发布流程未将其确认为正式生效版本。"
    }
  }
] as const;

export const LEGAL_RELEASE_GATES: readonly ReleaseGate[] = [
  {
    id: "contact-channels",
    state: "pending",
    label: {
      "en-US": "Privacy and support channels",
      "zh-CN": "隐私与支持渠道"
    },
    detail: {
      "en-US":
        "Verify that the published personal mailbox can receive privacy and support requests, monitor it, and document fallback handling through the other personal channels.",
      "zh-CN":
        "核验已公布的个人邮箱能够接收隐私及支持请求，持续监控该邮箱，并记录通过其他个人渠道进行备用联系的处理方式。"
    }
  },
  {
    id: "service-address",
    state: "pending",
    label: {
      "en-US": "Operator service address",
      "zh-CN": "运营者送达地址"
    },
    detail: {
      "en-US":
        "Provide and verify a legally usable service/contact address for the individual operator.",
      "zh-CN": "填写并核验个人运营者可依法用于联系和送达的地址。"
    }
  },
  {
    id: "supabase-assurance",
    state: "pending",
    label: {
      "en-US": "Supabase region and contracts",
      "zh-CN": "Supabase 地区与合同"
    },
    detail: {
      "en-US":
        "Confirm the Dashboard project region, DPA status, and current subprocessors. The region must not be guessed.",
      "zh-CN":
        "确认 Dashboard 项目地区、DPA 状态和当前子处理者；不得猜测地区。"
    }
  },
  {
    id: "rights-channel",
    state: "pending",
    label: {
      "en-US": "Cloud deletion and rights-request channel",
      "zh-CN": "云端删除与权利请求渠道"
    },
    detail: {
      "en-US":
        "Provide a working process for cloud-account deletion and privacy-rights requests, then verify it end to end.",
      "zh-CN":
        "建立云端账户删除和隐私权利请求流程，并完成端到端核验。"
    }
  },
  {
    id: "high-risk-feature-review",
    state: "pending",
    label: {
      "en-US": "Explicit legal review of high-risk behavior",
      "zh-CN": "高风险行为专项法律审阅"
    },
    detail: {
      "en-US":
        "Counsel must explicitly review Persona inference, automatic credential capture, search suggestions, public Nominatim use, and use-as-acceptance.",
      "zh-CN":
        "律师须明确审阅 Persona 推导、自动凭证捕获、搜索建议、公共 Nominatim 以及“使用即接受”。"
    }
  },
  {
    id: "international-mechanisms",
    state: "pending",
    label: {
      "en-US": "EEA/UK representation and transfer mechanisms",
      "zh-CN": "EEA/英国代表与跨境机制"
    },
    detail: {
      "en-US":
        "Determine whether an EEA or UK representative is required and confirm every applicable cross-border transfer mechanism.",
      "zh-CN":
        "确认是否需要 EEA 或英国代表，并核实所有适用的跨境传输机制。"
    }
  },
  {
    id: "copyleft-obligations",
    state: "pending",
    label: {
      "en-US": "GPL/LGPL and source-offer obligations",
      "zh-CN": "GPL/LGPL 与源码提供义务"
    },
    detail: {
      "en-US":
        "Complete third-party notice, corresponding-source, relinking, and written-offer duties for shipped targets.",
      "zh-CN":
        "完成各发布目标的第三方声明、对应源码、重新链接及书面提供义务。"
    }
  },
  {
    id: "final-publication-record",
    state: "pending",
    label: {
      "en-US": "Final effective date, version, and legal sign-off",
      "zh-CN": "最终生效日、版本与律师签字"
    },
    detail: {
      "en-US":
        "Replace the draft version, set an effective date, record final counsel approval, and switch status only after all other gates pass.",
      "zh-CN":
        "替换草案版本、填写生效日期、记录最终律师批准，并仅在其他门禁全部通过后切换状态。"
    }
  }
] as const;
