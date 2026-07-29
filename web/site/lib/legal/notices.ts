export type ThirdPartyNoticeItem = {
  readonly name: string;
  readonly version?: string;
  readonly ecosystem: string;
  readonly license: string;
  readonly source?: string;
  readonly repository?: string;
  readonly homepage?: string;
  readonly noticeText?: string;
  readonly licenseText?: string;
};

export type ThirdPartyNotices = {
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly packageCount: number;
  readonly ecosystems: Readonly<Record<string, number>>;
  readonly items: readonly ThirdPartyNoticeItem[];
};

export type LicenseNoticeGroup = {
  readonly id: string;
  readonly license: string;
  readonly licenseText: string;
  readonly items: readonly ThirdPartyNoticeItem[];
};

const stableGroupId = (index: number) =>
  `license-text-${String(index + 1).padStart(4, "0")}`;

export const combinedNoticeText = (
  item: ThirdPartyNoticeItem
): string => {
  const noticeText = item.noticeText?.trim();
  const licenseText = item.licenseText?.trim();
  const parts = [
    noticeText
      ? `NOTICE / ATTRIBUTION\n\n${noticeText}`
      : null,
    licenseText
      ? `LICENSE\n\n${licenseText}`
      : null
  ].filter((value): value is string => value !== null);

  return parts.length > 0
    ? parts.join("\n\n----------------------------------------\n\n")
    : `No license or notice text was captured for ${item.name}@${item.version}. See the recorded source identifier and canonical inventory before release.`;
};

export const httpSourceUrl = (
  value: string | undefined
): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

export const groupThirdPartyNotices = (
  notices: ThirdPartyNotices
): readonly LicenseNoticeGroup[] => {
  const grouped = new Map<
    string,
    {
      license: string;
      licenseText: string;
      items: ThirdPartyNoticeItem[];
    }
  >();

  for (const item of notices.items) {
    const licenseText = combinedNoticeText(item);
    const key = `${item.license}\u0000${licenseText}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    grouped.set(key, {
      license: item.license,
      licenseText,
      items: [item]
    });
  }

  return [...grouped.values()]
    .sort((left, right) => {
      const byLicense = left.license.localeCompare(right.license);
      if (byLicense !== 0) return byLicense;
      return left.items[0]!.name.localeCompare(right.items[0]!.name);
    })
    .map((group, index) => ({
      id: stableGroupId(index),
      ...group,
      items: group.items.sort((left, right) =>
        `${left.name}@${left.version}`.localeCompare(
          `${right.name}@${right.version}`
        )
      )
    }));
};
