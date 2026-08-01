export const LEGAL_DOCUMENT_VERSION = "1.0.0-draft";
export const LEGAL_ACCEPTANCE_KEY = "lyra.legal-acceptance.v1";

export type LegalAcceptanceRecord = {
  readonly termsVersion: string;
  readonly privacyVersion: string;
  readonly acceptedAt: string;
};

export const readLegalAcceptance = (): LegalAcceptanceRecord | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEGAL_ACCEPTANCE_KEY) ?? "null") as
      Partial<LegalAcceptanceRecord> | null;
    if (
      parsed?.termsVersion !== LEGAL_DOCUMENT_VERSION
      || parsed.privacyVersion !== LEGAL_DOCUMENT_VERSION
      || typeof parsed.acceptedAt !== "string"
      || Number.isNaN(Date.parse(parsed.acceptedAt))
    ) {
      return null;
    }
    return {
      termsVersion: parsed.termsVersion,
      privacyVersion: parsed.privacyVersion,
      acceptedAt: parsed.acceptedAt
    };
  } catch {
    return null;
  }
};

export const hasAcceptedCurrentLegalDocuments = (): boolean =>
  readLegalAcceptance() !== null;

export const recordLegalAcceptance = (acceptedAt = new Date()): LegalAcceptanceRecord => {
  const record: LegalAcceptanceRecord = {
    termsVersion: LEGAL_DOCUMENT_VERSION,
    privacyVersion: LEGAL_DOCUMENT_VERSION,
    acceptedAt: acceptedAt.toISOString()
  };
  window.localStorage.setItem(LEGAL_ACCEPTANCE_KEY, JSON.stringify(record));
  return record;
};
