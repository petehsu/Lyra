export type CdpSnapshot = {
  readonly available: boolean;
  readonly domNodes?: number;
  readonly consoleErrors?: number;
  readonly consoleWarnings?: number;
  readonly networkFailures?: number;
  readonly capturedAt: string;
  readonly unavailableReason?: string;
};

export type CdpInspectorSource = {
  readonly countDomNodes: () => Promise<number> | number;
  readonly readConsoleEntries?: () => Promise<readonly { readonly level: string }[]> | readonly { readonly level: string }[];
  readonly readNetworkFailures?: () => Promise<readonly unknown[]> | readonly unknown[];
};

const isErrorLevel = (level: string): boolean => {
  const normalized = level.toLowerCase();
  return normalized === "error" || normalized === "exception" || normalized === "fatal";
};

const isWarningLevel = (level: string): boolean => {
  const normalized = level.toLowerCase();
  return normalized === "warning" || normalized === "warn";
};

export const captureCdpSnapshot = async (
  source?: CdpInspectorSource
): Promise<CdpSnapshot> => {
  if (source === undefined) {
    return {
      available: false,
      capturedAt: new Date().toISOString(),
      unavailableReason: "No CDP inspector source was provided."
    };
  }

  const [domNodes, consoleEntries, networkFailures] = await Promise.all([
    source.countDomNodes(),
    source.readConsoleEntries?.() ?? [],
    source.readNetworkFailures?.() ?? []
  ]);

  return {
    available: true,
    domNodes,
    consoleErrors: consoleEntries.filter((entry) => isErrorLevel(entry.level)).length,
    consoleWarnings: consoleEntries.filter((entry) => isWarningLevel(entry.level)).length,
    networkFailures: networkFailures.length,
    capturedAt: new Date().toISOString()
  };
};
