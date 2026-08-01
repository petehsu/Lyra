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
  version: "1.0.0-draft",
  status: "pending",
  effectiveDate: null,
  lastVerified: "2026-08-02",
  applicableVersion: "Lyra Desktop 0.1.0-preview.1",
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
    serviceAddress:
      "徐远豪（Pete Hsu）收，中国重庆市梁平区梁山街道桂溪街新华村 / Attn: Xu Yuanhao (Pete Hsu), Xinhua Village, Guixi Street, Liangshan Subdistrict, Liangping District, Chongqing, China"
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
    state: "complete",
    label: {
      "en-US": "Privacy and support channels",
      "zh-CN": "隐私与支持渠道"
    },
    detail: {
      "en-US":
        "The operator confirmed on 2026-08-01 that the published personal mailbox and four personal contact channels are active; users are told to retry through another channel when delivery is unavailable.",
      "zh-CN":
        "运营者已于 2026-08-01 确认已公布的个人邮箱及四种个人联系方式可用；当某一渠道无法送达时，用户会被告知改用其他渠道。"
    }
  },
  {
    id: "service-address",
    state: "complete",
    label: {
      "en-US": "Operator service address",
      "zh-CN": "运营者送达地址"
    },
    detail: {
      "en-US":
        "The operator confirmed on 2026-08-02 that Xinhua Village is the complete name of the residential community, not an administrative village, and that the published address is the address used for parcel delivery.",
      "zh-CN":
        "运营者已于 2026-08-02 确认“新华村”为住宅小区的完整名称，并非行政村，所公布地址即实际使用的快递投递地址。"
    }
  },
  {
    id: "supabase-assurance",
    state: "complete",
    label: {
      "en-US": "Supabase region and contracts",
      "zh-CN": "Supabase 地区与合同"
    },
    detail: {
      "en-US":
        "Project region us-west-2 was verified through the authenticated Supabase Management API on 2026-08-01. On 2026-08-02, the authenticated organization dashboard confirmed that the current DPA is automatically incorporated into the Terms for all organizations and requires no separate signature; the official current subprocessor list dated 2026-06-01 was recorded.",
      "zh-CN":
        "已于 2026-08-01 通过经认证的 Supabase Management API 核验项目地区为 us-west-2；并于 2026-08-02 通过已登录的组织控制台确认：现行 DPA 自动并入所有组织适用的条款，无需另行签署，同时已记录日期为 2026-06-01 的官方现行子处理者清单。"
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
    state: "complete",
    label: {
      "en-US": "Explicit operator review of high-risk behavior",
      "zh-CN": "高风险行为专项运营者审阅"
    },
    detail: {
      "en-US":
        "On 2026-08-02, the operator completed the feature-by-feature review and accepted the disclosed residual risks for Persona inference, opt-in credential capture, trusted UIUX code, local-only location, search, cross-border model delivery, and versioned agreement acceptance. No independent counsel review was obtained or claimed.",
      "zh-CN":
        "运营者已于 2026-08-02 完成逐项审阅，并接受 Persona 推导、选择开启的凭证捕获、受信任 UIUX 代码、仅限本机的位置、搜索、模型跨境传输及版本化协议接受所披露的剩余风险。未取得且未声称取得独立律师审阅。"
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
        "The operator recorded no directed launch to the EEA or UK and a mandatory reassessment before that changes. The overall gate remains pending while the United States, Canada, Japan, and Singapore transfer matrix, Google OAuth, and fixed Skills destinations await final release review.",
      "zh-CN":
        "运营者已记录本 Preview 不主动面向 EEA 或英国发布，并要求在该情况变化前重新评估。美国、加拿大、日本、新加坡跨境矩阵以及 Google OAuth 和固定 Skills 目的地仍待最终发布审阅，因此整体门禁保持待完成。"
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
      "en-US": "Final effective date, version, and operator attestation",
      "zh-CN": "最终生效日、版本与运营者确认"
    },
    detail: {
      "en-US":
        "Replace the draft version, set an effective date, record the operator's final publication attestation and any independent advice actually obtained, and switch status only after all other gates pass.",
      "zh-CN":
        "替换草案版本、填写生效日期、记录运营者最终发布确认及任何实际取得的独立意见，并仅在其他门禁全部通过后切换状态。"
    }
  }
] as const;
