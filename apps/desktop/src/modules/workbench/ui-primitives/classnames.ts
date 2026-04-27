export type ClassNameValue = string | false | null | undefined;

export const cx = (...values: readonly ClassNameValue[]): string =>
  values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
