export const LEGAL_LOCALES = ["en-US", "zh-CN"] as const;

export type LegalLocale = (typeof LEGAL_LOCALES)[number];

export type LocalizedText = Readonly<Record<LegalLocale, string>>;

export type LegalStatus = "pending" | "effective" | "retired";

export type LegalBlock =
  | {
      readonly kind: "paragraph" | "notice";
      readonly text: LocalizedText;
    }
  | {
      readonly kind: "list";
      readonly items: readonly LocalizedText[];
    };

export type LegalSection = {
  readonly id: string;
  readonly heading: LocalizedText;
  readonly blocks: readonly LegalBlock[];
};

export type LegalDocument = {
  readonly id: "terms" | "privacy";
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly sections: readonly LegalSection[];
};

export type DataPractice = {
  readonly id: string;
  readonly category: LocalizedText;
  readonly fieldsAndSource: LocalizedText;
  readonly purpose: LocalizedText;
  readonly legalBasis: LocalizedText;
  readonly recipientAndRegion: LocalizedText;
  readonly retention: LocalizedText;
  readonly deletion: LocalizedText;
};

export type ProviderRecord = {
  readonly id: string;
  readonly provider: string;
  readonly service: LocalizedText;
  readonly data: LocalizedText;
  readonly region: LocalizedText;
  readonly privacyUrl: string | null;
  readonly trainingAndRetention: LocalizedText;
  readonly dpaStatus: LocalizedText;
  readonly reviewStatus: "verified" | "pending" | "user-configured";
};

export type ReleaseGate = {
  readonly id: string;
  readonly state: "pending" | "complete";
  readonly label: LocalizedText;
  readonly detail: LocalizedText;
};

export type LegalHistoryRecord = {
  readonly version: string;
  readonly status: LegalStatus;
  readonly date: string | null;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
};
