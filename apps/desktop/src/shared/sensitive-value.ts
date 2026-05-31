export type LyraSensitiveValueOwner =
  | "login-manager"
  | "ai-provider"
  | "download-manager"
  | "system"
  | "external";

export type LyraSensitiveValueKind =
  | "password"
  | "api_key"
  | "token"
  | "secret"
  | "credential";

export type LyraSensitiveValueCapability =
  | "list_metadata"
  | "use"
  | "fill"
  | "reveal_to_user"
  | "copy_to_clipboard";

export type LyraSensitiveValueOwnership = "user_owned";

export type LyraSensitiveValuePlaintextVisibility = "user_reveal_only";

export type LyraSensitiveValueOwnerRef =
  | {
      readonly kind: "login-manager-credential";
      readonly credentialId: string;
      readonly origin?: string;
      readonly username?: string;
    }
  | {
      readonly kind: "provider-secret";
      readonly providerId: string;
      readonly fieldId: string;
    }
  | {
      readonly kind: "download-remote-token";
      readonly tokenId: string;
    }
  | {
      readonly kind: "opaque";
      readonly owner: string;
      readonly valueId: string;
    };

export type LyraSensitiveValueRef = {
  readonly kind: "lyra-sensitive-value-ref";
  readonly id: string;
  readonly owner: LyraSensitiveValueOwner;
  readonly valueKind: LyraSensitiveValueKind;
  readonly ownership: LyraSensitiveValueOwnership;
  readonly label: string;
  readonly description?: string;
  readonly displayHint: string;
  readonly ownerRef: LyraSensitiveValueOwnerRef;
  readonly capabilities: readonly LyraSensitiveValueCapability[];
  readonly modelVisibility: "metadata_only";
  readonly plaintextVisibility: LyraSensitiveValuePlaintextVisibility;
};

export type LyraSensitiveValueRevealRequest = {
  readonly ref: LyraSensitiveValueRef;
  readonly reason?: string;
};

export type LyraSensitiveValueRevealResponse = {
  readonly refId: string;
  readonly value: string;
};

export type LyraSensitiveValueApi = {
  readonly revealToUser: (
    request: LyraSensitiveValueRevealRequest
  ) => Promise<LyraSensitiveValueRevealResponse>;
};

export const isLyraSensitiveValueRef = (
  value: unknown
): value is LyraSensitiveValueRef => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<LyraSensitiveValueRef>;
  const ownerRef = record.ownerRef;
  return record.kind === "lyra-sensitive-value-ref"
    && typeof record.id === "string"
    && typeof record.owner === "string"
    && typeof record.valueKind === "string"
    && (record.ownership === undefined || record.ownership === "user_owned")
    && typeof record.label === "string"
    && typeof record.displayHint === "string"
    && ownerRef !== null
    && typeof ownerRef === "object"
    && !Array.isArray(ownerRef)
    && record.modelVisibility === "metadata_only"
    && (
      record.plaintextVisibility === undefined
      || record.plaintextVisibility === "user_reveal_only"
    )
    && Array.isArray(record.capabilities)
    && record.capabilities.every((capability) => typeof capability === "string");
};

export const createLoginManagerPasswordRef = ({
  credentialId,
  origin,
  hostname,
  username
}: {
  readonly credentialId: string;
  readonly origin: string;
  readonly hostname: string;
  readonly username: string;
}): LyraSensitiveValueRef => ({
  kind: "lyra-sensitive-value-ref",
  id: `login-manager:credential-password:${credentialId}`,
  owner: "login-manager",
  valueKind: "password",
  ownership: "user_owned",
  label: `Password for ${username}`,
  description: `Saved password for ${hostname}`,
  displayHint: "••••••••",
  ownerRef: {
    kind: "login-manager-credential",
    credentialId,
    origin,
    username
  },
  capabilities: [
    "list_metadata",
    "use",
    "fill",
    "reveal_to_user",
    "copy_to_clipboard"
  ],
  modelVisibility: "metadata_only",
  plaintextVisibility: "user_reveal_only"
});
