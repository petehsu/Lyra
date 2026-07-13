import { getWorkbenchLocale } from "./locale-state";

// Formatters read the locale store rather than i18next.language, which makes
// formatting follow the same source of truth as React and preferences.

/** Format timestamp as time-only (HH:mm, 24h) */
export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(getWorkbenchLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

/** Format timestamp as short date+time (MM-dd HH:mm) */
export function formatShortDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(getWorkbenchLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

/** Format timestamp as medium date+time (MMM dd, HH:mm) */
export function formatMediumDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(getWorkbenchLocale(), {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

// ponytail: formatBytes 用二进制前缀 (KiB/MiB) — 代码库中最常见约定；toFixed 不走 locale 分组以保持原有行为
const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

/** Format byte count as human-readable size (binary prefixes) */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const exponent = Math.floor(Math.log(bytes) / Math.log(1024));
  const unitIndex = Math.min(exponent, BYTE_UNITS.length - 1);
  const value = bytes / Math.pow(1024, unitIndex);
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${BYTE_UNITS[unitIndex]}`;
}

/** Format number with locale-aware digit grouping */
export function formatNumber(n: number): string {
  return n.toLocaleString(getWorkbenchLocale());
}
