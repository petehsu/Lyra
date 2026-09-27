import { readLoginManagerStore } from "../login-manager/store";

type LoginMapElement = {
  readonly inputType?: string;
};

type SavedAccount = {
  readonly origin: string;
  readonly username: string;
};

export const loginMapNote = (
  url: string,
  elements: readonly LoginMapElement[],
  credentials: readonly SavedAccount[]
): string => {
  if (elements.some((element) => element.inputType === "password") === false) {
    return "";
  }
  if (URL.canParse(url) === false) return "";
  const origin = new URL(url).origin;
  const names = [...new Set(
    credentials
      .filter((credential) => credential.origin === origin && credential.username.trim().length > 0)
      .map((credential) => credential.username.trim())
  )];
  if (names.length === 0) {
    return "No saved sign-in for this site.";
  }
  return `Saved sign-in for this site: ${names.join(", ")}`;
};

export const loginMapNoteForStorage = (
  url: string,
  elements: readonly LoginMapElement[],
  storageRoot: string | undefined
): string => {
  if (storageRoot === undefined || storageRoot.length === 0) return "";
  const store = readLoginManagerStore(storageRoot);
  return loginMapNote(url, elements, store.credentials);
};
