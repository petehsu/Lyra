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
  version: "1.0.0",
  status: "effective",
  effectiveDate: "2026-08-06",
  lastVerified: "2026-08-06",
  applicableVersion: "Lyra Desktop 0.1.0-preview.2",
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
    state: "complete",
    label: {
      "en-US": "Cloud deletion and rights-request channel",
      "zh-CN": "云端删除与权利请求渠道"
    },
    detail: {
      "en-US":
        "On 2026-08-08 the operator (徐远豪 / Pete Hsu) completed the end-to-end verification required by the privacy-rights-requests runbook: a dedicated disposable production-like account exercised the published intake mailbox and one fallback footer channel, ownership was verified without collecting a password or token, the account and its profile row were deleted through the production operator path (the JWT-verified delete-account edge function in the us-west-2 project), the deleted user could no longer authenticate and own-row profile reads returned no record, local device data was not falsely represented as remotely deleted, and a redacted case-log entry plus completion response were archived. Supabase project region us-west-2, the auto-incorporated DPA, and the subprocessor list dated 2026-06-01 were recorded against the current provider-register version.",
      "zh-CN":
        "运营者（徐远豪 / Pete Hsu）于 2026-08-08 完成隐私权利请求操作手册要求的端到端核验：使用一次性生产级测试账号走通公布的受理邮箱及页脚任一备用渠道，在未收集密码或令牌的前提下完成归属验证，通过生产运营者路径（us-west-2 项目内经 JWT 验证的 delete-account 边缘函数）删除该账号及其 profiles 行，删除后用户无法再认证、按行读取 profiles 无记录，本机数据未被谎称为已远程删除，并归档了脱敏的 case-log 记录与完成回复；同时按现行 provider-register 版本记录了 Supabase 项目地区 us-west-2、自动并入的 DPA 及日期为 2026-06-01 的子处理者清单。"
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
    state: "complete",
    label: {
      "en-US": "EEA/UK representation and transfer mechanisms",
      "zh-CN": "EEA/英国代表与跨境机制"
    },
    detail: {
      "en-US":
        "Completed 2026-08-06 for the directed Preview markets. The record covers Supabase us-west-2 and its DPA, Cloudflare, Google OAuth, fixed user-initiated Skills endpoints, GitHub delivery, and user-selected AI/MCP destinations. Canada accountability/transparency, Japan foreign-third-party consent or continuing safeguards, Singapore comparable protection, and the absence of a universal United States transfer mechanism are recorded without claiming universal compliance. EEA/UK-directed distribution remains excluded and requires reassessment before it changes.",
      "zh-CN":
        "已于 2026-08-06 完成定向 Preview 市场审阅。记录覆盖 Supabase us-west-2 及其 DPA、Cloudflare、Google OAuth、由用户主动触发的固定 Skills 端点、GitHub 分发以及用户选择的 AI/MCP 目的地；同时记录加拿大问责与透明要求、日本对外国第三方提供的同意或持续保障、新加坡可比保护要求及美国不存在统一通用跨境机制的事实，不声称普遍合规。仍排除主动面向 EEA/英国发行，改变前须重新评估。"
    }
  },
  {
    id: "copyleft-obligations",
    state: "complete",
    label: {
      "en-US": "GPL/LGPL and source-offer obligations",
      "zh-CN": "GPL/LGPL 与源码提供义务"
    },
    detail: {
      "en-US":
        "Completed for the only current binary target, darwin-x64, on 2026-08-06. The Draft release includes exact conda package/license evidence, aria2/GMP/libiconv corresponding source, feedstock commits and recipes/patches, dynamic-link and replacement instructions, SOURCE-OFFER, independent checksums, canonical notices, and SBOMs. Every additional target requires its own generated and verified assets before publication.",
      "zh-CN":
        "已于 2026-08-06 针对当前唯一二进制目标 darwin-x64 完成。Draft Release 已包含精确 conda 包/许可证证据、aria2/GMP/libiconv 对应源码、feedstock commit 与配方/补丁、动态链接和替换说明、SOURCE-OFFER、独立校验和、规范 notices 及 SBOM。增加任何目标前均须生成并核验其独立资产。"
    }
  },
  {
    id: "final-publication-record",
    state: "complete",
    label: {
      "en-US": "Final effective date, version, and operator attestation",
      "zh-CN": "最终生效日、版本与运营者确认"
    },
    detail: {
      "en-US":
        "Version 1.0.0 and the August 6, 2026 effective date were confirmed by the operator on August 6, 2026. The operator's signed risk review records that no independent counsel was obtained. The release workflow emits a target-specific publication record with the source commit, build identifiers, and SHA-256 hashes of the canonical legal sources and notices.",
      "zh-CN":
        "运营者已于 2026 年 8 月 6 日确认 1.0.0 版本及 2026 年 8 月 6 日生效日期。运营者签署的风险审阅如实记录未取得独立律师审阅。发布工作流会生成目标专属发布记录，包含源码提交、构建标识及规范法律真源与 notices 的 SHA-256 摘要。"
    }
  }
] as const;
