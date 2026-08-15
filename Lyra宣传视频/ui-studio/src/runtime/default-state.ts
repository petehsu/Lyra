const defaultWorkbenchState: Readonly<Record<string, string>> = {
  location: JSON.stringify({
    consent: "denied",
    startupPromptAnswered: true
  })
};

export const readDefaultWorkbenchState = (key: string): string | null =>
  defaultWorkbenchState[key] ?? null;
